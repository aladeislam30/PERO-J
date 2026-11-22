import test from "node:test";
import assert from "node:assert/strict";
import { SingleFlight, getOrLoad } from "../src/singleFlight.js";

test("coalesces concurrent callers into one loader call", async () => {
  const sf = new SingleFlight();
  let calls = 0;
  const loader = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return 42;
  };
  const results = await Promise.all(Array.from({ length: 50 }, () => sf.do("k", loader)));
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r === 42));
  assert.equal(sf.size, 0);
});

test("failure is shared and key is released for retry", async () => {
  const sf = new SingleFlight();
  const bad = () => Promise.reject(new Error("boom"));
  await assert.rejects(Promise.all([sf.do("k", bad), sf.do("k", bad)]), /boom/);
  assert.equal(await sf.do("k", async () => 1), 1);
});

test("getOrLoad writes result to cache once", async () => {
  const store = new Map();
  let sets = 0;
  const cache = {
    get: async (k) => store.get(k),
    set: async (k, v) => (sets++, store.set(k, v)),
  };
  let calls = 0;
  const loader = async () => (calls++, "v");
  await Promise.all([1, 2, 3].map(() => getOrLoad(cache, "m", loader, { flight: new SingleFlight() })));
  assert.equal(calls, 1);
  assert.equal(sets, 1);
});
