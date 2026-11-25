import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api.js";
import { db } from "../src/db.js";

// HTTP-pipeline tests for list endpoints (issue #1154). DB methods are stubbed so
// no PostgreSQL instance is needed; Supertest/Vitest are not used because the
// indexer's test runner is node:test with no extra dependencies.
describe("API integration: pagination, filtering, error statuses (issue #1154)", () => {
  let server;
  let base;
  const calls = {};
  const orig = { getMarkets: db.getMarkets, getBets: db.getBets, getEvents: db.getEvents };

  before(() => {
    db.getMarkets = async (args) => {
      calls.markets = args;
      return { markets: [], items: [], next_cursor: null, total: 0, limit: args.limit, page: args.page };
    };
    db.getBets = async (args) => {
      calls.bets = args;
      return { items: [], next_cursor: null, total: 0, limit: args.limit, page: args.page };
    };
    db.getEvents = async (args) => {
      calls.events = args;
      return { items: [], next_cursor: null, total: 0, limit: args.limit, page: args.page };
    };
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    Object.assign(db, orig);
    await new Promise((r) => server.close(r));
  });

  it("markets: applies defaults and returns JSON schema", async () => {
    const res = await fetch(`${base}/api/v1/markets`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    const body = await res.json();
    assert.ok(Array.isArray(body.items));
    assert.deepEqual([calls.markets.limit, calls.markets.page, calls.markets.cursor], [20, 1, null]);
  });

  it("markets: offset pagination params reach the data layer", async () => {
    await fetch(`${base}/api/v1/markets?limit=5&page=3`);
    assert.deepEqual([calls.markets.limit, calls.markets.page], [5, 3]);
  });

  it("markets: cursor pagination param reaches the data layer", async () => {
    await fetch(`${base}/api/v1/markets?cursor=abc`);
    assert.equal(calls.markets.cursor, "abc");
  });

  it("markets: invalid sort or order returns 400", async () => {
    assert.equal((await fetch(`${base}/api/v1/markets?sort=password`)).status, 400);
    assert.equal((await fetch(`${base}/api/v1/markets?order=sideways`)).status, 400);
  });

  it("markets: valid sort and order return 200", async () => {
    assert.equal((await fetch(`${base}/api/v1/markets?sort=created_at&order=desc`)).status, 200);
  });

  it("bets: filters by market_id", async () => {
    const res = await fetch(`${base}/api/v1/bets?market_id=m1&limit=10`);
    assert.equal(res.status, 200);
    assert.equal(calls.bets.market_id, "m1");
    assert.equal(calls.bets.limit, 10);
  });

  it("events: filters by contract and fn", async () => {
    const res = await fetch(`${base}/api/v1/events?contract=C1&fn=transfer`);
    assert.equal(res.status, 200);
    assert.equal(calls.events.contract, "C1");
    assert.equal(calls.events.fn, "transfer");
  });

  it("unknown route returns 404", async () => {
    const res = await fetch(`${base}/api/v1/does-not-exist`);
    assert.equal(res.status, 404);
  });
});
