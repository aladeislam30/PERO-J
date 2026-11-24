import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import nock from "nock";
import { BinanceAdapter } from "../src/adapters/binance.js";
import { createDefaultRegistry } from "../src/adapters/index.js";
import { metrics, pollOnce } from "../src/daemon.js";
import { determineOutcome, submitExpiredMarket } from "../src/workers/auto-submitter.js";

const BINANCE = "https://api.binance.com";
const CMC = "https://pro-api.coinmarketcap.com";
const ODDS = "https://api.the-odds-api.com";
const CMC_PATH = /^\/v2\/cryptocurrency\/quotes\/latest/;
const BINANCE_PATH = /^\/api\/v3\/ticker\/price/;
const ODDS_PATH = /^\/v4\/sports\/nfl\/scores/;

const crypto = {
  id: "btc",
  slug: "crypto-btc",
  category: "crypto",
  params: { symbol: "BTCUSDT", cmc_symbol: "BTC", threshold: 100, comparator: "gte" },
};
const sports = {
  id: "game",
  slug: "sports-game",
  category: "sports",
  params: { sport: "nfl", event_id: "e1", winner: "A" },
};

const cmcBody = (price: unknown) => ({ data: { BTC: [{ quote: { USD: { price } } }] } });
const oddsBody = (scores: unknown) => [{ id: "e1", completed: true, scores }];
const binance = (price: unknown) => nock(BINANCE).get(BINANCE_PATH).reply(200, { price } as never);
const cmc = (price: unknown) => nock(CMC).get(CMC_PATH).reply(200, cmcBody(price));

type Market = typeof crypto | typeof sports;

/** In-memory stand-in for the `markets` table. */
function fakeDb(markets: Market[]) {
  const status = new Map<string, string>(markets.map((m) => [m.id, "open"]));
  return {
    status,
    query: async (sql: string, params: string[] = []) => {
      if (sql.startsWith("SELECT"))
        return { rows: markets.filter((m) => status.get(m.id) === "open") };
      const next = /SET status = '(\w+)'/.exec(sql)![1];
      if (next === "submitting" && status.get(params[0]) !== "open") return { rowCount: 0 };
      status.set(params[0], next);
      return { rowCount: 1 };
    },
  };
}

/** Run one real daemon poll; only the chain call and retry sleeps are stubbed. */
async function poll(markets: Market[]) {
  const registry = createDefaultRegistry({ timeoutMs: 100, sleep: async () => {} });
  const submitted: [string, boolean][] = [];
  const db = fakeDb(markets);
  await pollOnce(db as never, (d: any, market: any) =>
    submitExpiredMarket(d, market, {
      determine: (m: never) => determineOutcome(m, registry),
      submit: async (id: string, outcome: boolean) => void submitted.push([id, outcome]),
    }),
  );
  return { submitted, status: db.status };
}

describe("oracle daemon resilience", () => {
  let errorLog: ReturnType<typeof mock.method>;
  const logged = () => errorLog.mock.calls.map((c) => String(c.arguments[0])).join("\n");

  before(() => nock.disableNetConnect());
  after(() => {
    nock.enableNetConnect();
    nock.restore();
  });
  beforeEach(() => {
    errorLog = mock.method(console, "error", () => {});
  });
  afterEach(() => {
    errorLog.mock.restore();
    nock.abortPendingRequests();
    nock.cleanAll();
  });

  async function assertSkipped(market: Market, reason: RegExp) {
    const { submitted, status } = await poll([market]);
    assert.deepEqual(submitted, [], "nothing may reach the chain");
    assert.equal(status.get(market.id), "open", "market stays eligible for retry");
    assert.match(logged(), new RegExp(`market ${market.id} not submitted`));
    assert.match(logged(), reason);
  }

  it("submits when every provider is healthy", async () => {
    binance("101");
    cmc(102);
    const { submitted, status } = await poll([crypto]);
    assert.deepEqual(submitted, [["btc", true]]);
    assert.equal(status.get("btc"), "submitted");
  });

  describe("provider outages", () => {
    it("skips on persistent HTTP 500 after bounded retries", async () => {
      const outage = nock(BINANCE).get(BINANCE_PATH).times(3).reply(500, "oops");
      cmc(102);
      await assertSkipped(crypto, /binance: responded HTTP 500/);
      assert.ok(outage.isDone(), "expected one attempt and two retries");
    });

    it("recovers from a transient HTTP 500 within the same poll", async () => {
      nock(BINANCE).get(BINANCE_PATH).reply(500);
      binance("101");
      cmc(102);
      assert.deepEqual((await poll([crypto])).submitted, [["btc", true]]);
    });

    it("skips on connection resets", async () => {
      nock(BINANCE)
        .get(BINANCE_PATH)
        .times(3)
        .replyWithError(Object.assign(new Error("reset"), { code: "ECONNRESET" }));
      cmc(102);
      await assertSkipped(crypto, /binance: network request failed/);
    });

    it("skips on timeouts", async () => {
      nock(BINANCE).get(BINANCE_PATH).times(3).delay(2_000).reply(200, { price: "101" });
      cmc(102);
      await assertSkipped(crypto, /binance: request timed out/);
    });

    it("rejects a connection dropped midway through the body", async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Length": "100" });
        res.write('{"price":"10');
        setTimeout(() => res.destroy(), 10);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      nock.enableNetConnect("127.0.0.1");
      try {
        const { port } = server.address() as AddressInfo;
        const adapter = new BinanceAdapter({
          maxRetries: 0,
          fetchImpl: (_url: string, init: RequestInit) => fetch(`http://127.0.0.1:${port}`, init),
        } as never);
        await assert.rejects(adapter.resolve(crypto.params), /network request failed/);
      } finally {
        nock.disableNetConnect();
        server.closeAllConnections();
        server.close();
      }
    });

    it("does not leak API keys in logs", async () => {
      process.env.ODDSAPI_API_KEY = "super-secret";
      try {
        nock(ODDS).get(ODDS_PATH).reply(401, {});
        await assertSkipped(sports, /oddsapi: responded HTTP 401/);
        assert.doesNotMatch(logged(), /super-secret/);
      } finally {
        delete process.env.ODDSAPI_API_KEY;
      }
    });
  });

  describe("corrupt payloads", () => {
    for (const [label, body] of [
      ["truncated JSON", '{"price":"101"'],
      ["an HTML error page", "<html>maintenance</html>"],
      ["an empty body", ""],
    ]) {
      it(`skips on ${label}`, async () => {
        nock(BINANCE).get(BINANCE_PATH).reply(200, body);
        cmc(102);
        await assertSkipped(crypto, /not valid JSON/);
      });
    }

    for (const body of [
      "null",
      "[]",
      "{}",
      '{"price":null}',
      '{"price":""}',
      '{"price":"abc"}',
      '{"price":true}',
      '{"price":[101]}',
      '{"price":"0"}',
      '{"price":-5}',
      '{"last_price":"101"}',
    ]) {
      it(`skips on Binance body ${body}`, async () => {
        nock(BINANCE).get(BINANCE_PATH).reply(200, body);
        cmc(102);
        await assertSkipped(crypto, /binance: missing or invalid price/);
      });
    }

    it("skips when CoinMarketCap restructures its response", async () => {
      binance("101");
      nock(CMC).get(CMC_PATH).reply(200, { data: { BTC: [{ quotes: [{ price: 102 }] }] } });
      await assertSkipped(crypto, /coinmarketcap: missing or invalid price/);
    });

    it("skips when providers disagree", async () => {
      binance("101");
      cmc(99);
      await assertSkipped(crypto, /adapters disagree/);
    });

    it("skips when the market threshold is missing", async () => {
      binance("101");
      cmc(102);
      const market = { ...crypto, params: { ...crypto.params, threshold: undefined } };
      await assertSkipped(market as never, /threshold must be a finite number/);
    });

    for (const [label, body] of [
      ["a non-array body", { message: "quota" }],
      ["null scores", oddsBody(null)],
      ["a null score value", oddsBody([{ name: "A", score: null }, { name: "B", score: "1" }])],
      ["a missing team", oddsBody([{ name: "A", score: "2" }])],
    ] as const) {
      it(`skips sports markets on ${label}`, async () => {
        nock(ODDS).get(ODDS_PATH).reply(200, body as never);
        await assertSkipped(sports, /oddsapi:/);
      });
    }
  });

  describe("isolation", () => {
    it("processes healthy markets after a failed one", async () => {
      nock(BINANCE).get(BINANCE_PATH).reply(200, "{bad");
      cmc(102);
      nock(ODDS)
        .get(ODDS_PATH)
        .reply(200, oddsBody([{ name: "A", score: "2" }, { name: "B", score: "1" }]));
      const { submitted, status } = await poll([crypto, sports]);
      assert.deepEqual(submitted, [["game", true]]);
      assert.equal(status.get("btc"), "open");
    });

    it("resolves a skipped market once the provider recovers", async () => {
      nock(BINANCE).get(BINANCE_PATH).reply(200, "{bad");
      cmc(102);
      assert.deepEqual((await poll([crypto])).submitted, []);
      nock.cleanAll();
      binance("101");
      cmc(102);
      assert.deepEqual((await poll([crypto])).submitted, [["btc", true]]);
    });

    it("survives a worker that throws", async () => {
      const errors = metrics.pollErrors;
      const seen: string[] = [];
      await pollOnce(
        fakeDb([crypto, sports]) as never,
        async (_db: any, market: { id: string }) => {
          seen.push(market.id);
          if (market.id === "btc") throw new Error("db connection lost");
          return true;
        },
      );
      assert.deepEqual(seen, ["btc", "game"]);
      assert.equal(metrics.pollErrors, errors + 1);
      assert.match(logged(), /market btc failed: db connection lost/);
    });
  });
});
