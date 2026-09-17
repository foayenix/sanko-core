// Message aggregation for WhatsApp.
//
// People do not write to a bot the way they write to an API. They send "I want to
// record something", then "for malaria", then a voice note — three webhooks in
// four seconds. Answering each one separately produces three overlapping replies
// and three half-finished agent turns.
//
// So buffer inbound messages briefly and hand the agent all of them at once. The
// window is a debounce (it restarts on each new message) with a hard ceiling, so
// someone typing continuously still gets an answer.
//
// Runs per key (phone number) are also serialised: a flush never starts while the
// previous one for that key is still going, which is what keeps the stored
// conversation history in order.

const DEFAULT_WINDOW_MS = Number(process.env.AGGREGATION_WINDOW_MS ?? 2500);
const DEFAULT_MAX_WAIT_MS = Number(process.env.AGGREGATION_MAX_WAIT_MS ?? 10000);

class MessageAggregator {
  // onFlush — async (key, items) => void
  constructor(onFlush, { windowMs = DEFAULT_WINDOW_MS, maxWaitMs = DEFAULT_MAX_WAIT_MS } = {}) {
    this.onFlush = onFlush;
    this.windowMs = windowMs;
    this.maxWaitMs = maxWaitMs;
    this.buffers = new Map();  // key → { items, timer, firstAt }
    this.inFlight = new Map(); // key → promise of the running flush chain
  }

  push(key, item) {
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = { items: [], timer: null, firstAt: Date.now() };
      this.buffers.set(key, buffer);
    }
    buffer.items.push(item);

    if (buffer.timer) clearTimeout(buffer.timer);
    const elapsed = Date.now() - buffer.firstAt;
    const delay = Math.max(0, Math.min(this.windowMs, this.maxWaitMs - elapsed));
    buffer.timer = setTimeout(() => this.flush(key), delay);
    // Don't hold the event loop open just for a pending flush.
    if (typeof buffer.timer.unref === 'function') buffer.timer.unref();
  }

  // Drains the buffer for one key and runs onFlush, queued behind any flush
  // already in progress for that key. Returns a promise for tests to await.
  flush(key) {
    const buffer = this.buffers.get(key);
    if (!buffer) return this.inFlight.get(key) ?? Promise.resolve();

    if (buffer.timer) clearTimeout(buffer.timer);
    this.buffers.delete(key);
    const items = buffer.items;
    if (items.length === 0) return this.inFlight.get(key) ?? Promise.resolve();

    const previous = this.inFlight.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => {}) // a failed earlier flush must not cancel this one
      .then(() => this.onFlush(key, items));

    this.inFlight.set(key, run);
    run.finally(() => {
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    }).catch(() => {});

    return run;
  }

  // Flushes every pending key — used by tests and graceful shutdown.
  flushAll() {
    return Promise.all([...this.buffers.keys()].map(key => this.flush(key)));
  }

  pendingCount(key) {
    return this.buffers.get(key)?.items.length ?? 0;
  }
}

module.exports = { MessageAggregator, DEFAULT_WINDOW_MS, DEFAULT_MAX_WAIT_MS };
