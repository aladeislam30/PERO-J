# Live market streaming

`indexer/src/marketStream.js` provides a Server-Sent Events hub (`MarketHub`)
and `registerMarketStream(router, hub)`, which adds, on the v1 router:

- `GET /api/v1/stream/markets[?market=<id>]` - all markets or one market
- `GET /api/v1/markets/:id/live` - one market

Events are `id:`/`event:`/`data:` frames (`data` is JSON such as
`{ "type": "odds", "marketId": 1, ... }`). Features: 15s keepalive comment
heartbeat, `Last-Event-ID` replay from a 500-event ring buffer, listener cleanup
on client close, and per-connection backpressure (writes are skipped while the
socket buffer is full, and a consumer is disconnected after 50 skipped events).
Publish with `marketHub.publish(event)`.

## Redis pub/sub

`indexer/src/marketPubSub.js` forwards messages from a pub/sub channel to the
hub so events processed on one instance reach SSE clients on every instance.
See the module header. The repo has no Redis client dependency, so the
transport is an injected interface (`publish`, `subscribe`, `unsubscribe`) and
an in-memory implementation is provided for tests.

## Not implemented

- WebSocket server: needs the `ws` dependency, which is not in
  `indexer/package.json` (it cannot be added without updating the lockfile).
- Wiring ledger/bet event processing to call `publish`.

## Pub/sub details

`startMarketPubSub(subscriber)` subscribes to `stellar:markets:updates`, parses
JSON messages (those without a `marketId` or invalid JSON are dropped with a
warning) and calls `marketHub.publish`. It re-subscribes on the subscriber's
`ready` event after reconnects, and `stop()` removes listeners and unsubscribes.
Producers call `publishMarketUpdate(publisher, event)`, which never throws.

The call `startMarketPubSub(<ioredis subscriber>)` is not yet made in
`api.js`/`index.js` because `ioredis` is not listed in `indexer/package.json`
(existing `src/redis.js` imports it anyway). Add the dependency (with lockfile)
and call it at startup with a dedicated subscriber connection.
