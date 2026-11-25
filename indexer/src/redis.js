
import Redis from "ioredis";

// ---------------------------------------------------------------------------
// Singleton instances
// ---------------------------------------------------------------------------

let _client;
let _subscriber;

// ---------------------------------------------------------------------------
// In-memory stub used when REDIS_URL is not set (tests / local dev without Redis)
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory Redis stub that satisfies the get / set / del / exists /
 * publish / subscribe / unsubscribe surface used by MarketCacheManager.
 * It is intentionally not exported — callers always go through the
 * getRedisClient / getRedisSubscriber factories below.
 */
class InMemoryRedisStub {
  constructor() {
    this._store = new Map();
    this._subs = new Map(); // channel -> Set<handler>
  }

  async get(key) {
    return this._store.get(key) ?? null;
  }

  async set(key, value, ...rest) {
    // Accepts set(key, value) and set(key, value, "EX", ttl) — TTL is ignored
    // in the stub because tests don't depend on expiry.
    this._store.set(key, value);
    return "OK";
  }

  async del(...keys) {
    let count = 0;
    for (const key of keys.flat()) {
      if (this._store.delete(key)) count++;
    }
    return count;
  }

  async exists(...keys) {
    let count = 0;
    for (const key of keys.flat()) {
      if (this._store.has(key)) count++;
    }
    return count;
  }

  async publish(channel, message) {
    const handlers = this._subs.get(channel);
    if (handlers) {
      for (const h of handlers) {
        // Deliver asynchronously so callers don't depend on synchronous delivery.
        setImmediate(() => h(message));
      }
    }
    return handlers ? handlers.size : 0;
  }

  subscribe(channel, handler) {
    if (!this._subs.has(channel)) this._subs.set(channel, new Set());
    this._subs.get(channel).add(handler);
  }

  unsubscribe(channel, handler) {
    this._subs.get(channel)?.delete(handler);
  }

  on() {
    // No-op — stub never emits connection errors.
    return this;
  }

  flushall() {
    this._store.clear();
    return "OK";
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Return the shared Redis client (read/write operations).
 * Returns an in-memory stub when REDIS_URL is not set so tests and local
 * development work without a running Redis instance.
 */
export function getRedisClient() {
  if (_client === undefined) {
    _client = process.env.REDIS_URL

      ? new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        })
