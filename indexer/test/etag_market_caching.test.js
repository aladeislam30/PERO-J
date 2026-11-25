/**
 * Tests for ETag + If-None-Match HTTP caching on market read endpoints (issue #1143).
 *
 * Covers:
 *  - computeWeakETag / computeListETag helpers
 *  - GET /api/v1/markets/:id returns ETag + Cache-Control headers
 *  - GET /api/v1/markets/:id returns 304 with empty body when If-None-Match matches
 *  - GET /api/v1/markets/:id returns 200 when If-None-Match is stale
 *  - GET /api/v1/markets/:id returns 200 when market is updated (ETag changes)
 *  - GET /api/v1/markets (list) returns ETag + Cache-Control headers
 *  - GET /api/v1/markets (list) returns 304 when If-None-Match matches
 *  - 404 responses carry no ETag
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp, computeWeakETag, computeListETag } from "../src/api.js";
import { db } from "../src/db.js";
import { marketCacheManager } from "../src/cache-manager.js";
import { resetRedis } from "../src/redis.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Start the app on a random port, run fn(baseUrl), then cleanly close the
 * server regardless of whether fn throws.
 */
async function withServer(fn) {
  resetRedis();
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    marketCacheManager.stop();
    await new Promise((resolve) => server.close(resolve));
  }
}

const MARKET_A = {
  id: "mkt-etag-1",
  question: "Will XLM exceed $1 by end of 2026?",
  updated_at: "2026-10-15T12:00:00.000Z",
  bet_count: 42,
};

const MARKET_A_UPDATED = {
  ...MARKET_A,
  updated_at: "2026-10-15T13:30:00.000Z",
  bet_count: 43,
};

const MARKETS_LIST = [
  { id: "mkt-list-1", question: "Market one", updated_at: "2026-10-10T10:00:00.000Z", bet_count: 10 },
  { id: "mkt-list-2", question: "Market two", updated_at: "2026-10-12T08:00:00.000Z", bet_count: 7 },
];

// ---------------------------------------------------------------------------
// computeWeakETag unit tests
// ---------------------------------------------------------------------------

describe("computeWeakETag", () => {
  it("returns a weak ETag string in W/\"…\" format", () => {
    const etag = computeWeakETag(MARKET_A);
    assert.ok(typeof etag === "string", "should be a string");
    assert.ok(etag.startsWith('W/"'), `should start with W/" — got ${etag}`);
    assert.ok(etag.endsWith('"'), `should end with " — got ${etag}`);
  });

  it("produces a 16-character hex hash", () => {
    const etag = computeWeakETag(MARKET_A);
    // Strip W/" prefix and " suffix to get the raw hash.
    const hash = etag.slice(3, -1);
    assert.equal(hash.length, 16, `hash should be 16 hex chars, got ${hash.length}`);
    assert.ok(/^[0-9a-f]+$/.test(hash), `hash should be hex — got ${hash}`);
  });

  it("changes when updated_at changes", () => {
    const etag1 = computeWeakETag(MARKET_A);
    const etag2 = computeWeakETag(MARKET_A_UPDATED);
    assert.notEqual(etag1, etag2, "ETag must differ after updated_at changes");
  });

  it("changes when bet_count changes", () => {
    const base = computeWeakETag({ id: "x", updated_at: "2026-01-01", bet_count: 10 });
    const bumped = computeWeakETag({ id: "x", updated_at: "2026-01-01", bet_count: 11 });
    assert.notEqual(base, bumped, "ETag must differ after bet_count changes");
  });

  it("is deterministic: same inputs produce the same ETag", () => {
    assert.equal(computeWeakETag(MARKET_A), computeWeakETag({ ...MARKET_A }));
  });

  it("returns null for null / non-object inputs", () => {
    assert.equal(computeWeakETag(null), null);
    assert.equal(computeWeakETag(undefined), null);
    assert.equal(computeWeakETag("string"), null);
  });

  it("handles missing updated_at and bet_count gracefully", () => {
    const etag = computeWeakETag({ id: "bare" });
    assert.ok(etag.startsWith('W/"'), "should still produce a valid ETag for sparse objects");
  });
});

// ---------------------------------------------------------------------------
// computeListETag unit tests
// ---------------------------------------------------------------------------

describe("computeListETag", () => {
  it("returns a weak ETag string for a non-empty array", () => {
    const etag = computeListETag(MARKETS_LIST);
    assert.ok(etag.startsWith('W/"'));
  });

  it("returns null for an empty array", () => {
    assert.equal(computeListETag([]), null);
  });

  it("changes when a market's updated_at changes", () => {
    const etag1 = computeListETag(MARKETS_LIST);
    const updated = [
      MARKETS_LIST[0],
      { ...MARKETS_LIST[1], updated_at: "2026-10-13T09:00:00.000Z" },
    ];
    const etag2 = computeListETag(updated);
    assert.notEqual(etag1, etag2);
  });

  it("changes when the list length changes", () => {
    const etag1 = computeListETag(MARKETS_LIST);
    const etag2 = computeListETag([...MARKETS_LIST, { id: "mkt-list-3", updated_at: "2026-10-11T00:00:00.000Z" }]);
    assert.notEqual(etag1, etag2);
  });

  it("is deterministic for the same input", () => {
    assert.equal(computeListETag(MARKETS_LIST), computeListETag([...MARKETS_LIST]));
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/markets/:id — ETag + Cache-Control headers
// ---------------------------------------------------------------------------

describe("GET /api/v1/markets/:id — ETag caching headers", () => {
  it("returns ETag and Cache-Control headers with a 200 response", async () => {
    const original = db.getMarket;
    db.getMarket = async () => MARKET_A;

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`);
      assert.equal(res.status, 200);

      const etag = res.headers.get("etag");
      assert.ok(etag, "ETag header must be present");
      assert.ok(etag.startsWith('W/"'), `ETag must be weak — got ${etag}`);

      const cc = res.headers.get("cache-control");
      assert.ok(cc, "Cache-Control header must be present");
      assert.ok(cc.includes("max-age=5"), `Cache-Control must include max-age=5 — got ${cc}`);
      assert.ok(
        cc.includes("stale-while-revalidate=15"),
        `Cache-Control must include stale-while-revalidate=15 — got ${cc}`
      );
      assert.ok(cc.includes("public"), `Cache-Control must include public — got ${cc}`);
    });

    db.getMarket = original;
  });

  it("returns 304 with no body when If-None-Match matches the current ETag", async () => {
    const original = db.getMarket;
    db.getMarket = async () => MARKET_A;

    await withServer(async (baseUrl) => {
      // First request to obtain the ETag.
      const first = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`);
      assert.equal(first.status, 200);
      const etag = first.headers.get("etag");
      assert.ok(etag);

      // Second request with If-None-Match.
      const second = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`, {
        headers: { "if-none-match": etag },
      });

      assert.equal(second.status, 304, "unmodified market must return HTTP 304");
      const body = await second.text();
      assert.equal(body, "", "304 response must have an empty body");
    });

    db.getMarket = original;
  });

  it("returns 200 with fresh data when If-None-Match is stale", async () => {
    const original = db.getMarket;
    db.getMarket = async () => MARKET_A;

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`, {
        headers: { "if-none-match": 'W/"000000000000stale"' },
      });

      assert.equal(res.status, 200, "stale ETag must yield a fresh 200 response");
      const data = await res.json();
      assert.equal(data.id, MARKET_A.id);
    });

    db.getMarket = original;
  });

  it("returns a different ETag after the market is updated (bet_count bumped)", async () => {
    const original = db.getMarket;
    let call = 0;
    db.getMarket = async () => (call++ === 0 ? MARKET_A : MARKET_A_UPDATED);

    await withServer(async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`);
      const etagBefore = first.headers.get("etag");

      // Clear Redis cache so the second fetch goes to db.getMarket again.
      resetRedis();

      const second = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`);
      const etagAfter = second.headers.get("etag");

      assert.ok(etagBefore && etagAfter);
      assert.notEqual(
        etagBefore,
        etagAfter,
        "ETag must change when updated_at / bet_count changes"
      );
    });

    db.getMarket = original;
  });

  it("returns 404 without an ETag header when the market does not exist", async () => {
    const original = db.getMarket;
    db.getMarket = async () => null;

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/markets/nonexistent`);
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("etag"), null, "404 must not carry an ETag");
    });

    db.getMarket = original;
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/markets (list) — ETag + Cache-Control headers
// ---------------------------------------------------------------------------

describe("GET /api/v1/markets — ETag caching headers on list endpoint", () => {
  it("returns ETag and Cache-Control headers with a 200 response", async () => {
    const original = db.getMarkets;
    db.getMarkets = async () => ({ markets: MARKETS_LIST, next_cursor: null, total: 2, page: 1 });

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/markets`);
      assert.equal(res.status, 200);

      const etag = res.headers.get("etag");
      assert.ok(etag, "ETag header must be present on the list endpoint");
      assert.ok(etag.startsWith('W/"'));

      const cc = res.headers.get("cache-control");
      assert.ok(cc.includes("max-age=5"));
      assert.ok(cc.includes("stale-while-revalidate=15"));
      assert.ok(cc.includes("public"));
    });

    db.getMarkets = original;
  });

  it("returns 304 when If-None-Match matches the list ETag", async () => {
    const original = db.getMarkets;
    db.getMarkets = async () => ({ markets: MARKETS_LIST, next_cursor: null, total: 2, page: 1 });

    await withServer(async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/markets`);
      const etag = first.headers.get("etag");
      assert.ok(etag);

      const second = await fetch(`${baseUrl}/api/v1/markets`, {
        headers: { "if-none-match": etag },
      });

      assert.equal(second.status, 304, "unchanged list must return HTTP 304");
      const body = await second.text();
      assert.equal(body, "");
    });

    db.getMarkets = original;
  });

  it("returns 200 when If-None-Match is stale on the list endpoint", async () => {
    const original = db.getMarkets;
    db.getMarkets = async () => ({ markets: MARKETS_LIST, next_cursor: null, total: 2, page: 1 });

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/markets`, {
        headers: { "if-none-match": 'W/"aaaaaaaaaaaastale"' },
      });
      assert.equal(res.status, 200);
    });

    db.getMarkets = original;
  });

  it("returns a different ETag when a new market is added to the list", async () => {
    const original = db.getMarkets;
    let call = 0;
    db.getMarkets = async () =>
      call++ === 0
        ? { markets: MARKETS_LIST, next_cursor: null, total: 2 }
        : {
            markets: [
              ...MARKETS_LIST,
              { id: "mkt-list-3", question: "New market", updated_at: "2026-10-20T00:00:00.000Z", bet_count: 0 },
            ],
            next_cursor: null,
            total: 3,
          };

    await withServer(async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/markets`);
      const etagBefore = first.headers.get("etag");

      const second = await fetch(`${baseUrl}/api/v1/markets`);
      const etagAfter = second.headers.get("etag");

      assert.notEqual(etagBefore, etagAfter, "ETag must change when list contents change");
    });

    db.getMarkets = original;
  });
});

// ---------------------------------------------------------------------------
// Bandwidth reduction: 304 responses carry no JSON body
// ---------------------------------------------------------------------------

describe("304 response body is empty (bandwidth reduction)", () => {
  it("304 for /markets/:id has content-length 0 or no body", async () => {
    const original = db.getMarket;
    db.getMarket = async () => MARKET_A;

    await withServer(async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`);
      const etag = first.headers.get("etag");

      const second = await fetch(`${baseUrl}/api/v1/markets/${MARKET_A.id}`, {
        headers: { "if-none-match": etag },
      });

      assert.equal(second.status, 304);
      // body.text() returns "" for a 304 — no JSON payload sent
      assert.equal(await second.text(), "");
    });

    db.getMarket = original;
  });
});
