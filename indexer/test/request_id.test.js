import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  getRequestId,
  isValidRequestId,
  requestIdMiddleware,
  tagSqlWithRequestId,
} from "../src/requestContext.js";

function call(headers = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      requestIdMiddleware(req, res, async () => {
        await new Promise((r) => setTimeout(r, 5));
        res.end(JSON.stringify({ inCtx: getRequestId(), sql: tagSqlWithRequestId("SELECT 1") }));
      });
    });
    server.listen(0, () => {
      http.get({ port: server.address().port, headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          server.close();
          resolve({ headers: res.headers, body: JSON.parse(body) });
        });
      });
    });
  });
}

describe("X-Request-ID propagation (#1151)", () => {
  it("validates ids", () => {
    assert.equal(isValidRequestId("abc-123_X.:y"), true);
    assert.equal(isValidRequestId("bad id*/"), false);
    assert.equal(isValidRequestId("a".repeat(129)), false);
    assert.equal(isValidRequestId(""), false);
  });

  it("echoes a valid inbound id and exposes it across async boundaries and SQL", async () => {
    const r = await call({ "x-request-id": "trace-42" });
    assert.equal(r.headers["x-request-id"], "trace-42");
    assert.equal(r.body.inCtx, "trace-42");
    assert.equal(r.body.sql, "/* request_id=trace-42 */ SELECT 1");
  });

  it("generates an id when missing or invalid", async () => {
    const r = await call({ "x-request-id": "bad*/id" });
    assert.match(r.headers["x-request-id"], /^[0-9a-f-]{36}$/);
    assert.equal(r.body.inCtx, r.headers["x-request-id"]);
  });

  it("does not tag SQL outside a request", () => {
    assert.equal(tagSqlWithRequestId("SELECT 1"), "SELECT 1");
  });
});
