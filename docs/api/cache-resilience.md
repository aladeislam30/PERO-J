# Cache stampede protection and Redis degradation

## Single-flight coalescing (`indexer/src/singleFlight.js`)

`SingleFlight.do(key, loader)` shares one in-flight promise per key: the first
caller runs the loader (for example one PostgreSQL query) and all concurrent
callers await the same result. Errors are shared too, and the key is released
afterwards so the next call retries. `getOrLoad(cache, key, loader)` wraps a
cache-aside read: on a miss, one loader call runs and its result is written to
the cache once.

## Stale-while-revalidate fallback (`indexer/src/swrCache.js`)

`SwrCache` wraps any backend exposing async `get(key)` / `set(key, value, ttlMs)`
(for example a Redis client adapter) with:

- soft TTL: after it, the stale value is returned immediately and refreshed in
  the background (single-flighted);
- hard TTL: after it, the value is no longer served from cache;
- an in-process LRU copy of every value, used when the backend errors;
- degradation: backend errors are logged as warnings (never thrown), and after
  `failureThreshold` consecutive errors the backend is skipped for `cooldownMs`
  (circuit-breaker style) while requests are served from the LRU or the loader.

Status: the modules are self-contained and not yet wired into existing routes.
The repository has no Redis client dependency, so the backend is an injected
interface; plug in a real client adapter when one is added.
