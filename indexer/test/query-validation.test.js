import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSortParams, MARKET_SORT_COLUMNS } from "../src/query-validation.js";

describe("parseSortParams (issue #1153)", () => {
  it("accepts absent params", () => {
    assert.deepEqual(parseSortParams({}), { ok: true, sort: null, order: null });
  });
  it("accepts every allow-listed column and both orders", () => {
    for (const c of MARKET_SORT_COLUMNS) {
      assert.equal(parseSortParams({ sort: c, order: "DESC" }).order, "desc");
    }
  });
  it("rejects unknown columns and injection attempts", () => {
    for (const bad of ["id", "created_at; DROP TABLE markets", "1=1--", "", ["created_at", "ends_at"], { a: 1 }]) {
      assert.equal(parseSortParams({ sort: bad }).ok, false);
    }
  });
  it("rejects invalid order", () => {
    for (const bad of ["up", "asc; --", "", ["asc"]]) {
      assert.equal(parseSortParams({ order: bad }).ok, false);
    }
  });
});

describe("GET /api/v1/markets sort validation (issue #1153)", () => {
  it("returns 400 for an invalid sort column", async () => {
    const { createApp } = await import("../src/api.js");
    const server = createApp().listen(0);
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/markets?sort=${encodeURIComponent("x;DROP TABLE markets")}`);
      assert.equal(res.status, 400);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
