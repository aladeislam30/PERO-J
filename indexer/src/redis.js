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
      : new InMemoryRedisStub();
    _client.on?.("error", (err) => console.warn(`[redis:client] ${err.message}`));
  }
  return _client;
}

/**
 * Return the shared Redis subscriber connection (pub/sub).
 * Uses a separate connection from the main client as required by ioredis —
 * a connection in subscribe mode cannot issue regular commands.
 * Falls back to the same in-memory stub in non-Redis environments.
 */
export function getRedisSubscriber() {
  if (_subscriber === undefined) {
    _subscriber = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        })
      : new InMemoryRedisStub();
    _subscriber.on?.("error", (err) =>
      console.warn(`[redis:subscriber] ${err.message}`)
    );
  }
  return _subscriber;
}

/**
 * Reset both singleton instances.
 * Used by tests to get a fresh stub between test cases so stale cached
 * state from one test cannot bleed into the next.
 */
export function resetRedis() {
  _client = undefined;
  _subscriber = undefined;
}

// ---------------------------------------------------------------------------
// Legacy alias kept for backward compatibility with callers that use getRedis()
// ---------------------------------------------------------------------------

/** @deprecated Use getRedisClient() instead. */
export function getRedis() {
  return getRedisClient();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Publish a JSON message to a Redis pub/sub channel.
 * Never throws — Redis failures must not block the caller (e.g. the indexing
 * transaction). Returns true on success, false on failure or when Redis is
 * not configured.
 *
 * @param {string} channel
 * @param {object} message
 * @param {any} [redis]
 * @returns {Promise<boolean>}
 */
export async function publish(channel, message, redis = getRedisClient()) {
  if (!redis) return false;
  try {
    await redis.publish(channel, JSON.stringify(message));
    return true;
  } catch (err) {
    console.warn(`[redis] publish to ${channel} failed: ${err.message}`);
    return false;
  }
}
