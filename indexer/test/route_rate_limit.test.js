import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRouteRateLimiter, resolvePolicy } from "../src/routeRateLimit.js";

function run(limiter, method, url, ip = "1.1.1.1") {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader(k, v) { headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let passed = false;
  limiter({ method, originalUrl: url, url, ip }, res, () => { passed = true; });
  return { res, headers, passed };
}

describe("per-route rate limits (#1149)", () => {
  it("maps paths to buckets", () => {
    assert.equal(resolvePolicy("GET", "/api/v1/markets/1").max, 120);
    assert.equal(resolvePolicy("GET", "/api/v1/bets").max, 60);
    assert.equal(resolvePolicy("POST", "/api/v1/oracle/audit-bonds").max, 10);
    assert.equal(resolvePolicy("POST", "/api/v1/disputes/bonds").max, 10);
    assert.equal(resolvePolicy("GET", "/api/v1/events").max, 100);
  });

  it("returns 429 with Retry-After once the bucket is exhausted", () => {
    const limiter = createRouteRateLimiter({ now: () => 1_000_000 });
    for (let i = 0; i < 10; i++) {
      assert.equal(run(limiter, "POST", "/api/v1/oracle/audit-bonds").passed, true);
    }
    const blocked = run(limiter, "POST", "/api/v1/oracle/audit-bonds");
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
    assert.equal(blocked.headers["X-RateLimit-Remaining"], "0");
    assert.equal(blocked.headers["RateLimit-Limit"], "10");
  });

  it("tracks buckets and clients independently and resets after the window", () => {
    let t = 0;
    const limiter = createRouteRateLimiter({ now: () => t });
    for (let i = 0; i < 11; i++) run(limiter, "POST", "/api/v1/oracle/x");
    assert.equal(run(limiter, "GET", "/api/v1/markets").passed, true);
    assert.equal(run(limiter, "POST", "/api/v1/oracle/x", "2.2.2.2").passed, true);
    t = 61_000;
    assert.equal(run(limiter, "POST", "/api/v1/oracle/x").passed, true);
  });
});
