/**
 * Redis pub/sub adapter feeding the SSE hub (issue #1148).
 *
 * Works with an ioredis-style subscriber: `subscribe(channel)` returning a
 * promise, `unsubscribe(channel)`, and `on("message", (channel, msg) => ...)`
 * / `off`. A second client does the publishing: `publish(channel, string)`.
 * No Redis client is a dependency of this repo, so both are injected.
 */
import { EventEmitter } from "node:events";
import { marketHub } from "./marketStream.js";

export const MARKET_UPDATES_CHANNEL = "stellar:markets:updates";

/** Publish a market event so every API instance forwards it to local SSE clients. */
export async function publishMarketUpdate(publisher, event, channel = MARKET_UPDATES_CHANNEL) {
  try {
    await publisher.publish(channel, JSON.stringify(event));
    return true;
  } catch (err) {
    console.warn(`[marketPubSub] publish failed: ${err?.message || err}`);
    return false;
  }
}

/**
 * Subscribe to the channel and forward valid messages to the hub.
 * Re-subscribes on the subscriber's "ready" event (reconnects) and is
 * idempotent to stop(). Returns { stop }.
 */
export function startMarketPubSub(subscriber, { hub = marketHub, channel = MARKET_UPDATES_CHANNEL, logger = console } = {}) {
  const onMessage = (ch, raw) => {
    if (ch !== channel) return;
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      logger.warn?.("[marketPubSub] dropping non-JSON message");
      return;
    }
    if (!event || typeof event !== "object" || event.marketId === undefined) {
      logger.warn?.("[marketPubSub] dropping message without marketId");
      return;
    }
    hub.publish(event);
  };
  const doSubscribe = () =>
    Promise.resolve(subscriber.subscribe(channel)).catch((err) =>
      logger.warn?.(`[marketPubSub] subscribe failed: ${err?.message || err}`)
    );

  subscriber.on("message", onMessage);
  subscriber.on("ready", doSubscribe);
  doSubscribe();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      subscriber.off("message", onMessage);
      subscriber.off("ready", doSubscribe);
      Promise.resolve(subscriber.unsubscribe(channel)).catch(() => {});
    },
  };
}

/** In-memory transport for tests: one object acts as publisher and subscriber. */
export class MemoryPubSub extends EventEmitter {
  async subscribe(channel) {
    (this.channels ??= new Set()).add(channel);
  }
  async unsubscribe(channel) {
    this.channels?.delete(channel);
  }
  async publish(channel, message) {
    if (this.channels?.has(channel)) this.emit("message", channel, message);
  }
}
