/**
 * Tests for Redis-backed cache invalidation triggered by BetPlaced events (issue #1144).
 *
 * All tests use the in-memory Redis stub (no REDIS_URL set) so they run
 * without an external Redis instance.  The stub delivers pub/sub messages
 * asynchronously via setImmediate(), matching real Redis delivery semantics.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MarketCacheManager,
  calculateOdds,
  BET_PLACED_CHANNEL,
} from "../src/cache-manager.js";
import { getRedisClient, getRedisSubscriber, resetRedis, publish } from "../src/redis.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait one event-loop tick so setImmediate-based pub/sub delivery fires. */
function tick(ms = 20) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// calculateOdds
// ---------------------------------------------------------------------------

describe("calculateOdds", () => {
  it("computes accurate odds from outcome pool totals", () => {
    const pools = { yes: 6000, no: 4000 };
    const odds = calculateOdds(pools, 10000);
    // yes: 10000/6000 = 1.6667; no: 10000/4000 = 2.5
    assert.equal(odds.yes, 1.6667);
    assert.equal(odds.no, 2.5);
  });

  it("infers total from pool values when totalPool is 0 / falsy", () => {
    const pools = { yes: 3000, no: 7000 };
    const odds = calculateOdds(pools, 0);
    // total inferred = 10000; yes: 10000/3000 ≈ 3.3333; no: 10000/7000 ≈ 1.4286
    assert.equal(odds.yes, 3.3333);
    assert.equal(odds.no, 1.4286);
  });

  it("returns 1.0 for an outcome whose pool is 0", () => {
    const pools = { yes: 10000, no: 0 };
    const odds = calculateOdds(pools, 10000);
    assert.equal(odds.no, 1.0);
  });

  it("returns an empty object for a non-object argument", () => {
    assert.deepEqual(calculateOdds(null, 0), {});
    assert.deepEqual(calculateOdds(undefined, 0), {});
  });
});

// ---------------------------------------------------------------------------
// MarketCacheManager — invalidateMarketCache
// ---------------------------------------------------------------------------

describe("MarketCacheManager.invalidateMarketCache", () => {
  beforeEach(() => resetRedis());

  it("deletes market:${id} and market:${id}:odds from Redis", async () => {
    const redis = getRedisClient();
    const marketId = "mkt-test-1";

    await redis.set(`market:${marketId}`, JSON.stringify({ id: marketId }));
    await redis.set(`market:${marketId}:odds`, JSON.stringify({ yes: 2.0 }));

    assert.equal(await redis.exists(`market:${marketId}`), 1);
    assert.equal(await redis.exists(`market:${marketId}:odds`), 1);

    const manager = new MarketCacheManager({ redisClient: redis });
    const result = await manager.invalidateMarketCache(marketId);

    assert.equal(result.purged, true);
    assert.equal(result.marketKey, `market:${marketId}`);
    assert.equal(result.oddsKey, `market:${marketId}:odds`);

    assert.equal(await redis.exists(`market:${marketId}`), 0, "market key should be purged");
    assert.equal(await redis.exists(`market:${marketId}:odds`), 0, "odds key should be purged");
  });

  it("returns { purged: false } when marketId is falsy", async () => {
    const manager = new MarketCacheManager({ redisClient: getRedisClient() });
    const result = await manager.invalidateMarketCache("");
    assert.equal(result.purged, false);
  });
});

// ---------------------------------------------------------------------------
// MarketCacheManager — prewarmCache
// ---------------------------------------------------------------------------

describe("MarketCacheManager.prewarmCache", () => {
  beforeEach(() => resetRedis());

  it("writes market data under market:${id} with EX ttl", async () => {
    const redis = getRedisClient();
    const manager = new MarketCacheManager({ redisClient: redis });
    const marketId = "mkt-prewarm-1";

    await manager.prewarmCache(marketId, {
      market: { id: marketId, total_volume: 5000 },
      odds: { yes: 1.8, no: 2.2 },
    });

    const rawMarket = await redis.get(`market:${marketId}`);
    assert.ok(rawMarket, "market key should be populated");
    assert.equal(JSON.parse(rawMarket).total_volume, 5000);

    const rawOdds = await redis.get(`market:${marketId}:odds`);
    assert.ok(rawOdds, "odds key should be populated");
    assert.deepEqual(JSON.parse(rawOdds), { yes: 1.8, no: 2.2 });
  });

  it("computes odds from outcome_pools when odds are not supplied directly", async () => {
    const redis = getRedisClient();
    const manager = new MarketCacheManager({ redisClient: redis });
    const marketId = "mkt-prewarm-2";

    await manager.prewarmCache(marketId, {
      outcome_pools: { yes: 8000, no: 2000 },
      total_pool: 10000,
    });

    const rawOdds = await redis.get(`market:${marketId}:odds`);
    assert.ok(rawOdds);
    const odds = JSON.parse(rawOdds);
    // yes: 10000/8000 = 1.25; no: 10000/2000 = 5.0
    assert.equal(odds.yes, 1.25);
    assert.equal(odds.no, 5.0);
  });

  it("is a no-op when marketId is falsy", async () => {
    const manager = new MarketCacheManager({ redisClient: getRedisClient() });
    // Should resolve without throwing
    await assert.doesNotReject(() => manager.prewarmCache("", {}));
  });
});

// ---------------------------------------------------------------------------
// MarketCacheManager — handleBetPlacedEvent
// ---------------------------------------------------------------------------

describe("MarketCacheManager.handleBetPlacedEvent", () => {
  beforeEach(() => resetRedis());

  it("purges stale keys and pre-warms fresh data in under 100ms", async () => {
    const redis = getRedisClient();
    const manager = new MarketCacheManager({ redisClient: redis });
    const marketId = "mkt-event-1";

    // Seed stale cache
    await redis.set(`market:${marketId}`, JSON.stringify({ id: marketId, total_volume: 500 }));
    await redis.set(`market:${marketId}:odds`, JSON.stringify({ yes: 2.0, no: 2.0 }));

    const payload = {
      market_id: marketId,
      total_pool: 15000,
      outcome_pools: { yes: 10000, no: 5000 },
      odds: { yes: 1.5, no: 3.0 },
      market: { id: marketId, total_volume: 15000 },
    };

    const result = await manager.handleBetPlacedEvent(payload);

    assert.equal(result.success, true);
    assert.equal(result.market_id, marketId);
    assert.equal(result.prewarmed, true);
    assert.ok(
      result.latency_ms < 100,
      `Latency ${result.latency_ms}ms must be < 100ms (SLA)`
    );

    // Stale data gone; fresh data present
    const freshMarket = await manager.getMarket(marketId);
    assert.equal(freshMarket.total_volume, 15000);

    const freshOdds = await manager.getMarketOdds(marketId);
    assert.deepEqual(freshOdds, { yes: 1.5, no: 3.0 });
  });

  it("accepts a JSON string payload (pub/sub delivers strings)", async () => {
    const manager = new MarketCacheManager({ redisClient: getRedisClient() });
    const marketId = "mkt-string-payload";
    const payload = JSON.stringify({
      market_id: marketId,
      total_pool: 1000,
      outcome_pools: { yes: 600, no: 400 },
    });

    const result = await manager.handleBetPlacedEvent(payload);
    assert.equal(result.success, true);
    assert.equal(result.market_id, marketId);
  });

  it("supports camelCase marketId field alias", async () => {
    const manager = new MarketCacheManager({ redisClient: getRedisClient() });
    const result = await manager.handleBetPlacedEvent({ marketId: "mkt-camel", total_pool: 100 });
    assert.equal(result.success, true);
    assert.equal(result.market_id, "mkt-camel");
  });

  it("returns success:false when market_id is missing from the payload", async () => {
    const manager = new MarketCacheManager({ redisClient: getRedisClient() });
    const result = await manager.handleBetPlacedEvent({ total_pool: 500 });
    assert.equal(result.success, false);
    assert.ok(result.error.includes("market_id"));
  });

  it("returns success:false when payload is not valid JSON", async () => {
    const manager = new MarketCacheManager({ redisClient: getRedisClient() });
    const result = await manager.handleBetPlacedEvent("not-json{{{");
    assert.equal(result.success, false);
  });

  it("tracks invalidation metrics after each event", async () => {
    const manager = new MarketCacheManager({ redisClient: getRedisClient() });

    assert.equal(manager.metrics.invalidations, 0);

    await manager.handleBetPlacedEvent({ market_id: "mkt-metrics-1", total_pool: 100 });
    assert.equal(manager.metrics.invalidations, 1);
    assert.ok(manager.metrics.lastInvalidatedAt !== null);

    await manager.handleBetPlacedEvent({ market_id: "mkt-metrics-2", total_pool: 200 });
    assert.equal(manager.metrics.invalidations, 2);
  });
});

// ---------------------------------------------------------------------------
// MarketCacheManager — pub/sub wiring (stellar:events:mkt:bet channel)
// ---------------------------------------------------------------------------

describe("MarketCacheManager — pub/sub via stellar:events:mkt:bet", () => {
  beforeEach(() => resetRedis());

  it("handles events published to BET_PLACED_CHANNEL after start()", async () => {
    // Use the same in-memory stub for both client and subscriber so publish()
    // routes directly to the subscription handler.
    const redis = getRedisClient();
    const manager = new MarketCacheManager({
      redisClient: redis,
      redisSubscriber: redis,
    });

    manager.start();

    const marketId = "mkt-pubsub-1";
    await publish(
      BET_PLACED_CHANNEL,
      {
        market_id: marketId,
        total_pool: 20000,
        outcome_pools: { yes: 12000, no: 8000 },
        odds: { yes: 1.6667, no: 2.5 },
        market: { id: marketId, total_volume: 20000 },
      },
      redis
    );

    // Allow the setImmediate delivery cycle to complete.
    await tick(30);

    const odds = await manager.getMarketOdds(marketId);
    assert.deepEqual(odds, { yes: 1.6667, no: 2.5 });

    const market = await manager.getMarket(marketId);
    assert.equal(market.total_volume, 20000);

    manager.stop();
  });

  it("does not process events after stop()", async () => {
    const redis = getRedisClient();
    const manager = new MarketCacheManager({
      redisClient: redis,
      redisSubscriber: redis,
    });

    manager.start();
    manager.stop();

    const marketId = "mkt-pubsub-stopped";
    await publish(
      BET_PLACED_CHANNEL,
      { market_id: marketId, total_pool: 500 },
      redis
    );

    await tick(30);

    // Because the manager unsubscribed, the market should not be in cache.
    const market = await manager.getMarket(marketId);
    assert.equal(market, null, "stopped manager should not process pub/sub events");
  });

  it("is idempotent: calling start() twice does not double-subscribe", async () => {
    const redis = getRedisClient();
    const manager = new MarketCacheManager({
      redisClient: redis,
      redisSubscriber: redis,
    });

    manager.start();
    manager.start(); // second call must be a no-op

    const marketId = "mkt-idempotent";
    await publish(
      BET_PLACED_CHANNEL,
      { market_id: marketId, total_pool: 300, odds: { yes: 1.0 }, market: { id: marketId } },
      redis
    );

    await tick(30);

    // If subscribed twice, handleBetPlacedEvent would run twice → metrics.invalidations === 2.
    // The idempotency guard must keep it at exactly 1.
    assert.equal(manager.metrics.invalidations, 1, "event handler must fire exactly once");

    manager.stop();
  });

  it("channel constant is stellar:events:mkt:bet", () => {
    assert.equal(BET_PLACED_CHANNEL, "stellar:events:mkt:bet");
  });
});

// ---------------------------------------------------------------------------
// getRedisClient / getRedisSubscriber / resetRedis
// ---------------------------------------------------------------------------

describe("redis.js factory functions", () => {
  beforeEach(() => resetRedis());

  it("getRedisClient returns the same instance on repeated calls (singleton)", () => {
    const a = getRedisClient();
    const b = getRedisClient();
    assert.strictEqual(a, b);
  });

  it("getRedisSubscriber returns the same instance on repeated calls (singleton)", () => {
    const a = getRedisSubscriber();
    const b = getRedisSubscriber();
    assert.strictEqual(a, b);
  });

  it("getRedisClient and getRedisSubscriber return separate instances", () => {
    const client = getRedisClient();
    const subscriber = getRedisSubscriber();
    assert.notStrictEqual(
      client,
      subscriber,
      "client and subscriber must be separate connections"
    );
  });

  it("resetRedis produces a fresh stub on the next call", () => {
    const before = getRedisClient();
    resetRedis();
    const after = getRedisClient();
    assert.notStrictEqual(before, after, "resetRedis must produce a new instance");
  });
});
