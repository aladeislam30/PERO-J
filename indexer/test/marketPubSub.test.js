import test from "node:test";
import assert from "node:assert/strict";
import { MarketHub } from "../src/marketStream.js";
import { MemoryPubSub, startMarketPubSub, publishMarketUpdate } from "../src/marketPubSub.js";

const quiet = { warn() {} };

test("forwards published messages to the hub and stops cleanly", async () => {
  const bus = new MemoryPubSub();
  const hub = new MarketHub();
  const seen = [];
  const orig = hub.publish.bind(hub);
  hub.publish = (e) => (seen.push(e), orig(e));
  const sub = startMarketPubSub(bus, { hub, logger: quiet });
  await new Promise((r) => setImmediate(r));
  assert.equal(await publishMarketUpdate(bus, { type: "odds", marketId: 7 }), true);
  bus.emit("message", "stellar:markets:updates", "not json");
  assert.equal(seen.length, 1);
  sub.stop();
  sub.stop();
  assert.equal(bus.listenerCount("message"), 0);
});
