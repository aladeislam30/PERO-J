import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MarketHub } from "../src/marketStream.js";

function fakeRes() {
  const r = new EventEmitter();
  r.chunks = [];
  r.writableNeedDrain = false;
  r.write = (c) => (r.chunks.push(c), true);
  r.end = () => (r.writableEnded = true);
  return r;
}

test("filters by market and cleans up", () => {
  const hub = new MarketHub();
  const a = fakeRes();
  const b = fakeRes();
  const ca = hub.add(a, { marketId: "1", heartbeatMs: 1e6 });
  hub.add(b, { marketId: "2", heartbeatMs: 1e6 });
  hub.publish({ type: "odds", marketId: 1 });
  assert.equal(a.chunks.length, 1);
  assert.equal(b.chunks.length, 0);
  hub.remove(ca);
  assert.equal(hub.clientCount, 1);
  hub.closeAll();
  assert.equal(hub.clientCount, 0);
});

test("replays events after Last-Event-ID", () => {
  const hub = new MarketHub();
  hub.publish({ type: "odds", marketId: 1 });
  const id2 = hub.publish({ type: "odds", marketId: 1 });
  const res = fakeRes();
  hub.add(res, { lastEventId: id2 - 1, heartbeatMs: 1e6 });
  assert.equal(res.chunks.length, 1);
  hub.closeAll();
});

test("drops writes and disconnects slow consumers", () => {
  const hub = new MarketHub({ maxDrops: 1 });
  const res = fakeRes();
  res.writableNeedDrain = true;
  hub.add(res, { heartbeatMs: 1e6 });
  hub.publish({ type: "x", marketId: 1 });
  hub.publish({ type: "x", marketId: 1 });
  assert.equal(res.chunks.length, 0);
  assert.equal(hub.clientCount, 0);
});
