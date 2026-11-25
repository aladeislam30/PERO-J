/**
 * SSE hub for live odds / bet / market status streaming (issue #1147).
 * Endpoints (registered on the v1 router):
 *   GET /stream/markets[?market=<id>]  all markets or one market
 *   GET /markets/:id/live              one market
 * Features: heartbeat, Last-Event-ID replay from a ring buffer, cleanup on
 * close, and per-connection backpressure (drop when the socket buffer is full,
 * disconnect slow consumers after maxDrops).
 * WebSocket is NOT implemented: the repo has no `ws` dependency.
 */

export class MarketHub {
  constructor({ bufferSize = 500, maxDrops = 50 } = {}) {
    this.clients = new Set();
    this.buffer = [];
    this.bufferSize = bufferSize;
    this.maxDrops = maxDrops;
    this.nextId = 1;
  }

  get clientCount() {
    return this.clients.size;
  }

  /** Publish an event ({type, marketId, ...}) to matching local clients. */
  publish(event) {
    const msg = { id: this.nextId++, event };
    this.buffer.push(msg);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    for (const c of [...this.clients]) this._send(c, msg);
    return msg.id;
  }

  _matches(client, event) {
    return !client.marketId || String(event.marketId) === client.marketId;
  }

  _send(client, msg) {
    if (!this._matches(client, msg.event)) return;
    const res = client.res;
    if (res.writableEnded || res.destroyed) return this.remove(client);
    if (res.writableNeedDrain) {
      if (++client.drops > this.maxDrops) {
        this.remove(client);
        res.end();
      }
      return;
    }
    res.write(`id: ${msg.id}\nevent: ${msg.event.type || "message"}\ndata: ${JSON.stringify(msg.event)}\n\n`);
  }

  add(res, { marketId = null, lastEventId = 0, heartbeatMs = 15000 } = {}) {
    const client = { res, marketId: marketId ? String(marketId) : null, drops: 0, timer: null };
    this.clients.add(client);
    client.timer = setInterval(() => {
      if (res.writableNeedDrain) return;
      res.write(": keepalive\n\n");
    }, heartbeatMs);
    client.timer.unref?.();
    for (const msg of this.buffer) if (msg.id > lastEventId) this._send(client, msg);
    return client;
  }

  remove(client) {
    clearInterval(client.timer);
    this.clients.delete(client);
  }

  closeAll() {
    for (const c of [...this.clients]) {
      this.remove(c);
      c.res.end();
    }
  }
}

export const marketHub = new MarketHub();

function attach(hub, req, res, marketId) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const lastEventId = Number.parseInt(req.headers["last-event-id"] ?? req.query?.lastEventId, 10) || 0;
  res.write("retry: 3000\n\n");
  const client = hub.add(res, { marketId, lastEventId });
  const cleanup = () => hub.remove(client);
  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

/** Register SSE routes on an Express router/app. */
export function registerMarketStream(router, hub = marketHub) {
  router.get("/stream/markets", (req, res) =>
    attach(hub, req, res, req.query.market ? String(req.query.market) : null)
  );
  router.get("/markets/:id/live", (req, res) => attach(hub, req, res, req.params.id));
}
