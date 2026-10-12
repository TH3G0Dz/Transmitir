export class SlidingWindowLimiter {
  #events = new Map();
  #calls = 0;
  constructor({ windowMs, limit, now = Date.now, maxKeys = 10000, cleanupEvery = 256 }) {
    this.windowMs = windowMs;
    this.limit = limit;
    this.now = now;
    this.maxKeys = maxKeys;
    this.cleanupEvery = cleanupEvery;
  }
  consume(key) {
    const now = this.now();
    const cutoff = now - this.windowMs;
    if (++this.#calls % this.cleanupEvery === 0 || (!this.#events.has(key) && this.#events.size >= this.maxKeys)) {
      for (const [storedKey, timestamps] of this.#events) {
        const active = timestamps.filter((time) => time > cutoff);
        if (active.length) this.#events.set(storedKey, active);
        else this.#events.delete(storedKey);
      }
    }
    if (!this.#events.has(key) && this.#events.size >= this.maxKeys) return false;
    const events = (this.#events.get(key) ?? []).filter((time) => time > cutoff);
    if (events.length >= this.limit) {
      this.#events.set(key, events);
      return false;
    }
    events.push(now);
    this.#events.set(key, events);
    return true;
  }
  forget(key) { this.#events.delete(key); }
}
