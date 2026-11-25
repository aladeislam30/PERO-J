/**
 * Stale-while-revalidate cache wrapper with Redis degradation fallback (issue #1146).
 * The backend is any object with async get(key) / set(key, value, ttlMs).
 */
import { SingleFlight } from "./singleFlight.js";

export class SwrCache {
  constructor(
    backend,
    {
      softTtlMs = 30000,
      hardTtlMs = 300000,
      maxEntries = 500,
      failureThreshold = 3,
      cooldownMs = 10000,
      logger = console,
      now = () => Date.now(),
    } = {}
  ) {
    this.backend = backend;
    this.softTtlMs = softTtlMs;
    this.hardTtlMs = hardTtlMs;
    this.maxEntries = maxEntries;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.logger = logger;
    this.now = now;
    this.lru = new Map();
    this.flight = new SingleFlight();
    this.failures = 0;
    this.openUntil = 0;
  }

  get degraded() {
    return this.now() < this.openUntil;
  }

  _noteFailure(op, err) {
    this.failures++;
    this.logger.warn?.(`[swrCache] backend ${op} failed: ${err?.message || err}`);
    if (this.failures >= this.failureThreshold) {
      this.openUntil = this.now() + this.cooldownMs;
      this.failures = 0;
    }
  }

  _lruGet(key) {
    const e = this.lru.get(key);
    if (!e) return undefined;
    this.lru.delete(key);
    this.lru.set(key, e);
    return e;
  }

  _lruSet(key, entry) {
    this.lru.delete(key);
    this.lru.set(key, entry);
    while (this.lru.size > this.maxEntries) this.lru.delete(this.lru.keys().next().value);
  }

  async _read(key) {
    if (!this.degraded) {
      try {
        const e = await this.backend.get(key);
        this.failures = 0;
        if (e) return e;
      } catch (err) {
        this._noteFailure("get", err);
      }
    }
    return this._lruGet(key);
  }

  async _write(key, entry) {
    this._lruSet(key, entry);
    if (this.degraded) return;
    try {
      await this.backend.set(key, entry, this.hardTtlMs);
    } catch (err) {
      this._noteFailure("set", err);
    }
  }

  _refresh(key, loader) {
    return this.flight.do(key, async () => {
      const value = await loader();
      await this._write(key, { value, storedAt: this.now() });
      return value;
    });
  }

  /** Returns a cached value, a stale value (refreshing in background), or loads it. */
  async get(key, loader) {
    const entry = await this._read(key);
    if (entry) {
      const age = this.now() - entry.storedAt;
      if (age < this.softTtlMs) return entry.value;
      if (age < this.hardTtlMs) {
        this._refresh(key, loader).catch((err) =>
          this.logger.warn?.(`[swrCache] background refresh failed: ${err?.message || err}`)
        );
        return entry.value;
      }
    }
    try {
      return await this._refresh(key, loader);
    } catch (err) {
      if (entry) {
        this.logger.warn?.(`[swrCache] loader failed, serving stale: ${err?.message || err}`);
        return entry.value;
      }
      throw err;
    }
  }

  async invalidate(key) {
    this.lru.delete(key);
    if (this.degraded) return;
    try {
      await this.backend.set(key, null, 1);
    } catch (err) {
      this._noteFailure("invalidate", err);
    }
  }
}

/** In-memory backend for tests / local dev. */
export class MemoryBackend {
  constructor() {
    this.m = new Map();
  }
  async get(k) {
    return this.m.get(k);
  }
  async set(k, v) {
    this.m.set(k, v);
  }
}
