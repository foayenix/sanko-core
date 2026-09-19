// Small in-memory set with per-entry TTL. Used for webhook message
// deduplication (Meta retries deliveries with the same message id) and for
// throttling the first-contact privacy notice. Single-instance only — fine
// for the Railway MVP deployment; replace with Redis/Postgres if we scale out.

class TtlSet {
  constructor(ttlMs, maxSize = 5000) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.entries = new Map(); // key → expiry epoch ms
  }

  has(key) {
    const expiry = this.entries.get(key);
    if (expiry === undefined) return false;
    if (expiry <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(key) {
    if (this.entries.size >= this.maxSize) this._prune();
    this.entries.set(key, Date.now() + this.ttlMs);
  }

  // Forget an entry before its TTL. The webhook uses this to undo a claim it
  // took for work that then did not start, so the retry is not swallowed.
  delete(key) {
    return this.entries.delete(key);
  }

  _prune() {
    const now = Date.now();
    for (const [key, expiry] of this.entries) {
      if (expiry <= now) this.entries.delete(key);
    }
    // Still over budget after dropping expired entries — evict oldest
    while (this.entries.size >= this.maxSize) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }
}

module.exports = { TtlSet };
