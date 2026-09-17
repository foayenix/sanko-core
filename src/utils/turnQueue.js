'use strict';

// A queue in front of the model.
//
// One 32B model on one M1 Max, and Ollama serialises: a tool-heavy turn is
// minutes, not seconds. Without a queue, three practitioners messaging at once
// meant three concurrent turns fighting for the same weights, each one slower
// than if they had simply waited — and the third practitioner watching a silent
// chat for long enough to conclude the bot was broken.
//
// Three properties:
//
//   · turns for ONE practitioner run strictly in order, never concurrently, so
//     the second message of a burst sees the effect of the first;
//   · at most CONCURRENCY turns run at once across all practitioners, matching
//     what the hardware can actually do;
//   · anyone who will wait longer than ACK_AFTER_MS is told so, because silence
//     and failure are indistinguishable on a phone.
//
// This is per-instance. Serialisation ACROSS instances is the turn lease in
// migration 012; the two compose — this one keeps a single process orderly and
// cheap, that one keeps two processes from interleaving on the same Vault.

const { envNumber } = require('./env');
const log = require('./log');

// One local model, so one turn. Raise it only for a backend that genuinely
// serves in parallel — on Ollama a second concurrent turn makes both slower.
const CONCURRENCY = envNumber('AGENT_CONCURRENCY', 1);

// Long enough that a normal turn never sends it, short enough to land before
// someone assumes nothing is happening.
const ACK_AFTER_MS = envNumber('AGENT_QUEUE_ACK_MS', 4000);

// Past this, the queue is not busy — something is wrong. Rejecting is kinder
// than a reply that arrives after the practitioner has given up and moved on.
const MAX_QUEUE_DEPTH = envNumber('AGENT_QUEUE_MAX_DEPTH', 40);
const MAX_WAIT_MS = envNumber('AGENT_QUEUE_MAX_WAIT_MS', 10 * 60 * 1000);

class TurnQueue {
  constructor({ concurrency = CONCURRENCY, ackAfterMs = ACK_AFTER_MS, maxDepth = MAX_QUEUE_DEPTH, maxWaitMs = MAX_WAIT_MS, now = () => Date.now() } = {}) {
    this.concurrency = concurrency;
    this.ackAfterMs = ackAfterMs;
    this.maxDepth = maxDepth;
    this.maxWaitMs = maxWaitMs;
    this.now = now;

    this.pending = [];          // waiting to start
    this.running = new Set();   // keys currently executing
    this.depth = 0;
  }

  get size() {
    return this.pending.length;
  }

  // `key` is the practitioner: two entries with the same key never run at once,
  // and they run in the order they arrived.
  //
  // `onWait` is called once, with the wait so far in ms, if this turn has not
  // started within ackAfterMs — that is where the "still working on it" message
  // is sent from. It must not throw anything the caller cares about.
  run(key, task, { onWait } = {}) {
    if (this.depth >= this.maxDepth) {
      log.error('queue.rejected', { key, depth: this.depth, limit: this.maxDepth });
      return Promise.reject(new Error('The queue is full. Sanko is not keeping up with the messages it is receiving.'));
    }

    return new Promise((resolve, reject) => {
      const entry = { key, task, resolve, reject, onWait, queuedAt: this.now(), ackTimer: null };
      this.depth++;
      this.pending.push(entry);

      if (onWait) {
        entry.ackTimer = setTimeout(() => {
          entry.ackTimer = null;
          try {
            onWait(this.now() - entry.queuedAt);
          } catch (err) {
            log.warn('queue.ack_failed', { key, error: err.message });
          }
        }, this.ackAfterMs);
        // A pending acknowledgement must never hold the process open.
        entry.ackTimer.unref?.();
      }

      this._drain();
    });
  }

  _drain() {
    while (this.running.size < this.concurrency) {
      // First entry whose key is not already running — a blocked practitioner
      // must not block everyone behind them.
      const index = this.pending.findIndex(entry => !this.running.has(entry.key));
      if (index === -1) return;

      const [entry] = this.pending.splice(index, 1);
      const waited = this.now() - entry.queuedAt;

      if (waited > this.maxWaitMs) {
        this._finish(entry, () => entry.reject(new Error(`Waited ${Math.round(waited / 1000)}s for a turn and gave up.`)));
        continue;
      }

      this.running.add(entry.key);
      if (waited > this.ackAfterMs) log.info('queue.started_late', { key: entry.key, waited_ms: waited });

      Promise.resolve()
        .then(() => entry.task())
        .then(
          value => this._finish(entry, () => entry.resolve(value)),
          error => this._finish(entry, () => entry.reject(error)),
        );
    }
  }

  _finish(entry, settle) {
    this.running.delete(entry.key);
    this.depth--;
    if (entry.ackTimer) clearTimeout(entry.ackTimer);
    settle();
    // Settling may have freed a slot for a key that was blocked a moment ago.
    queueMicrotask(() => this._drain());
  }
}

// The process-wide queue. One model, one queue.
const turnQueue = new TurnQueue();

module.exports = { TurnQueue, turnQueue, CONCURRENCY, ACK_AFTER_MS };
