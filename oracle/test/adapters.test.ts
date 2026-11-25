import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { BaseAdapter, TokenBucket } from "../src/adapters/base.js";
import { createDefaultRegistry } from "../src/adapters/index.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { determineOutcome } from "../src/workers/auto-submitter.js";

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), init);

function fakeClock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
  };
}

class TestAdapter extends BaseAdapter {
  constructor(options: object = {}) {
    super({
      name: "test",
      rateLimit: { capacity: 100, refillPerSecond: 100 },
      ...options,
    } as never);
  }
}

describe("TokenBucket", () => {
  it("allows a burst up to capacity, then spaces concurrent callers", async () => {
    const waits: number[] = [];
    const bucket = new TokenBucket({
      capacity: 2,
      refillPerSecond: 1,
      now: () => 0,
      sleep: async (ms: number) => void waits.push(ms),
    });
    await Promise.all([1, 2, 3, 4].map(() => bucket.acquire()));
    assert.deepEqual(waits, [1000, 2000]);
  });

  it("never accumulates more than its capacity", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, ...clock });
    await clock.sleep(60_000);
    await bucket.acquire();
    await bucket.acquire();
    assert.deepEqual(clock.sleeps, [60_000, 1000]);
  });
});

describe("BaseAdapter", () => {
  it("is abstract", () => {
    assert.throws(() => new BaseAdapter({ name: "x" } as never), /abstract/);
  });

  it("retries 5xx with exponential backoff, spending a token per attempt", async () => {
    const clock = fakeClock();
    const statuses = [500, 503, 200];
    const adapter = new TestAdapter({
      ...clock,
      rateLimit: { capacity: 3, refillPerSecond: 0.001 },
      fetchImpl: async () => json({ ok: 1 }, { status: statuses.shift() }),
    });
    assert.deepEqual(await adapter.getJson("https://x.test"), { ok: 1 });
    assert.deepEqual(clock.sleeps, [250, 500]);
    assert.ok(adapter.limiter.tokens < 0.01);
  });

  it("honours Retry-After and gives up when it exceeds the cap", async () => {
    const run = async (retryAfter: string) => {
      const clock = fakeClock();
      let calls = 0;
      const adapter = new TestAdapter({
        ...clock,
        fetchImpl: async () =>
          ++calls === 1
            ? json({}, { status: 429, headers: { "Retry-After": retryAfter } })
            : json({}),
      });
      const error = await adapter.getJson("https://x.test").then(
        () => null,
        (e: Error) => e,
      );
      return { calls, error, sleeps: clock.sleeps };
    };
    assert.deepEqual(await run("2"), { calls: 2, error: null, sleeps: [2000] });
    const capped = await run("3600");
    assert.equal(capped.calls, 1);
    assert.match(String(capped.error), /429/);
  });

  it("does not retry 4xx", async () => {
    let calls = 0;
    const adapter = new TestAdapter({
      fetchImpl: async () => (calls++, json({}, { status: 401 })),
    });
    await assert.rejects(adapter.getJson("https://x.test"), /HTTP 401/);
    assert.equal(calls, 1);
  });
});

describe("AdapterRegistry", () => {
  const named = (name: string) => new TestAdapter({ name });
  const names = (list: BaseAdapter[]) => list.map((a) => a.name);

  it("routes by slug before category", () => {
    const r = new AdapterRegistry()
      .register(named("a"))
      .register(named("b"))
      .routeSlug("btc-*", ["a"])
      .routeCategory("crypto", ["b"]);
    assert.deepEqual(names(r.resolve({ slug: "btc-100k", category: "crypto" })), ["a"]);
    assert.deepEqual(names(r.resolve({ slug: "eth", category: "crypto" })), ["b"]);
    assert.throws(() => r.resolve({ slug: "eth" }), /no adapters/);
  });

  it("rejects non-adapters, duplicates and unknown routes", () => {
    const r = new AdapterRegistry().register(named("a"));
    assert.throws(() => r.register({} as never), /BaseAdapter/);
    assert.throws(() => r.register(named("a")), /already/);
    assert.throws(() => r.routeSlug("x", ["missing"]), /not registered/);
    assert.throws(() => r.routeCategory("x", []), /at least one/);
  });

  it("serves every market type through resolve()", async () => {
    const fixture = (file: string) =>
      readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
    const r = createDefaultRegistry(
      {
        fetchImpl: async (url: string | URL) => {
          const host = new URL(url).host;
          if (host === "api.binance.com") return json({ price: "101" });
          if (host === "pro-api.coinmarketcap.com")
            return json({ data: { BTC: [{ quote: { USD: { price: 102 } } }] } });
          if (host === "api.the-odds-api.com")
            return json([
              {
                id: "e1",
                completed: true,
                scores: [
                  { name: "A", score: "1" },
                  { name: "B", score: "2" },
                ],
              },
            ]);
          if (host === "elections.test") return new Response(fixture("politics-final.json"));
          return new Response(fixture("launch-scrubbed.json"));
        },
      },
      { POLITICS_FEED_URL: "https://elections.test/feed" } as never,
    );
    const cases: [string, object][] = [
      ["crypto-btc", { symbol: "BTCUSDT", cmc_symbol: "BTC", threshold: 100 }],
      ["sports-x", { sport: "nfl", event_id: "e1", winner: "B" }],
      [
        "politics-x",
        {
          electionId: "us-example-2024",
          raceId: "president-example",
          candidateId: "candidate-b",
        },
      ],
      ["science-x", { launchId: "launch-example", outcome: "scrubbed" }],
    ];
    for (const [slug, params] of cases) {
      assert.equal(await determineOutcome({ id: slug, slug, params }, r), true, slug);
    }
  });
});

describe("TheOddsApiAdapter", () => {
  const resolve = (winner: string, a: unknown, b: unknown) =>
    createDefaultRegistry({
      fetchImpl: async () =>
        json([
          {
            id: "e",
            completed: true,
            scores: [
              { name: "A", score: a },
              { name: "B", score: b },
            ],
          },
        ]),
    })
      .get("oddsapi")!
      .resolve({ sport: "soccer", event_id: "e", winner });

  it("does not credit either team with a draw", async () => {
    assert.equal(await resolve("A", "1", "1"), false);
    assert.equal(await resolve("B", "1", "1"), false);
    assert.equal(await resolve("Draw", "1", "1"), true);
  });

  it("rejects null scores and unknown winners", async () => {
    await assert.rejects(resolve("A", null, "1"), /invalid score/);
    await assert.rejects(resolve("C", "2", "1"), /did not play/);
  });
});
