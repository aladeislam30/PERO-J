import test from "node:test";
import assert from "node:assert/strict";
import { SwrCache, MemoryBackend } from "../src/swrCache.js";

const quiet = { warn() {} };

test("serves stale value and refreshes in background", async () => {
  let t = 0;
  const c = new SwrCache(new MemoryBackend(), { softTtlMs: 10, hardTtlMs: 1000, now: () => t, logger: quiet });
  let n = 0;
  const loader = async () => ++n;
  assert.equal(await c.get("k", loader), 1);
  t = 50;
  assert.equal(await c.get("k", loader), 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(await c.get("k", loader), 2);
});

test("backend errors fall back to LRU/loader without throwing", async () => {
  const bad = {
    get: async () => { throw new Error("down"); },
    set: async () => { throw new Error("down"); },
  };
  const c = new SwrCache(bad, { logger: quiet, failureThreshold: 2 });
  let n = 0;
  const loader = async () => ++n;
  assert.equal(await c.get("k", loader), 1);
  assert.equal(await c.get("k", loader), 1);
  assert.equal(n, 1);
  for (let i = 0; i < 3; i++) await c.get("k", loader);
  assert.equal(c.degraded, true);
});

test("serves stale when loader fails after hard ttl", async () => {
  let t = 0;
  const c = new SwrCache(new MemoryBackend(), { softTtlMs: 1, hardTtlMs: 5, now: () => t, logger: quiet });
  await c.get("k", async () => "old");
  t = 100;
  assert.equal(await c.get("k", async () => { throw new Error("db"); }), "old");
});
