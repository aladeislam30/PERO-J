import express from "express";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "./db.js";
import { fetchTokenMetadata } from "./sep41Metadata.js";
import { registerMarketStream } from "./marketStream.js";
import { formatOracleDisputes, oracleDisputes } from "./oracleDisputes.js";
import { health } from "./index.js";
import { eventEmitter } from "./events.js";
import { getRedis } from "./redis.js";
import { MAX_TITLE_LEN, MAX_DESCRIPTION_LEN } from "./sanitize.js";
import { parseSortParams } from "./query-validation.js";
import { marketCacheManager } from "./cache-manager.js";
import { BET_PLACED_CHANNEL } from "./cache-manager.js";
import { publish } from "./redis.js";
import { bondEscrowWorker } from "./bond-escrow-worker.js";
import { renderMetrics } from "./metrics.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { registerOracleRoutes } from "./oracle.js";
import {
  verifyAndConsumeOracleAttestation,
  OracleVerificationError,
} from "./oracle.js";


const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// ETag helpers (issue #1143)
// ---------------------------------------------------------------------------

/**
 * Compute a weak ETag for a market object based on its last-modified
 * timestamp and bet count.  Weak ETags (`W/"…"`) signal that two
 * representations are semantically equivalent even if not byte-for-byte
 * identical, which is the right choice for JSON API payloads where field
 * order or whitespace may vary between serialisations.
 *
 * The tag is derived from:
 *   SHA-256( updated_at || ":" || bet_count )[0..15]
 *
 * Both fields come from the database row, so the tag changes automatically
 * whenever a new bet is recorded or the market is otherwise updated.
 *
 * @param {object} market - A market row as returned by db.getMarket().
 * @param {string|Date|null} [market.updated_at]
 * @param {number|string|null} [market.bet_count]
 * @returns {string|null} Weak ETag value, e.g. `W/"a3f8c1d204e76b90"`.
 */
export function computeWeakETag(market) {
  if (!market || typeof market !== "object") return null;
  const updatedAt = market.updated_at ? String(market.updated_at) : "0";
  const betCount = market.bet_count != null ? String(market.bet_count) : "0";
  const hash = createHash("sha256")
    .update(`${updatedAt}:${betCount}`)
    .digest("hex")
    .slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Compute a weak ETag for a collection of markets (list endpoint).
 * Uses the most-recently-updated market's timestamp combined with the
 * total count of items so the tag changes on any addition or modification.
 *
 * @param {object[]} markets
 * @returns {string|null}
 */
export function computeListETag(markets) {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  // Pick the latest updated_at across all items.
  const latestUpdatedAt = markets.reduce((latest, m) => {
    const t = m.updated_at ? new Date(m.updated_at).getTime() : 0;
    return t > latest ? t : latest;
  }, 0);
  const count = markets.length;
  const hash = createHash("sha256")
    .update(`${latestUpdatedAt}:${count}`)
    .digest("hex")
    .slice(0, 16);
  return `W/"${hash}"`;
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Admin-key authentication middleware for privileged operations.
 * Reads the expected key from the API_ADMIN_KEY environment variable
 * and validates it against an Authorization: Bearer <key> header.
 *
 * During a zero-downtime key rotation (see docs/SECRET-ROTATION.md) the
 * previous key may be supplied via API_ADMIN_KEY_PREVIOUS and is accepted
 * until it is removed at the end of the overlap window.
 */
const requireAdminKey = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;
  const accepted = [process.env.API_ADMIN_KEY, process.env.API_ADMIN_KEY_PREVIOUS].filter(Boolean);
  if (!token || !accepted.includes(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

/**
 * Global Express error-handling middleware.
 * Logs the full stack trace together with the request method and path
 * so that unhandled errors are debuggable in production logs.
 *
 * @param {Error} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} _next
 */
export function errorHandler(err, req, res, _next) {
  console.error("API Error:", { method: req.method, path: req.path, stack: err.stack });
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: err.message || "Internal Server Error" });
}

export function isValidStellarAddress(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return StrKey.isValidEd25519PublicKey(trimmed) || StrKey.isValidContract(trimmed);
}

/**
 * Validates the payload for registering/updating contract ABI metadata.
 *
 * @param {unknown} body
 * @returns {string|null} an error message when invalid, otherwise null
 */
export function validateContractPayload(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }

  const { id, name, description, functions } = body;

  if (typeof id !== "string" || id.trim() === "") {
    return "id must be a non-empty string";
  }

  if (typeof name !== "string" || name.trim() === "") {
    return "name must be a non-empty string";
  }

  if (name.length > MAX_TITLE_LEN) {
    return `name exceeds maximum limit of ${MAX_TITLE_LEN} characters`;
  }

  if (typeof description === "string" && description.length > MAX_DESCRIPTION_LEN) {
    return `description exceeds maximum limit of ${MAX_DESCRIPTION_LEN} characters`;
  }

  if (!Array.isArray(functions)) {
    return "functions must be an array";
  }

  return null;
}

function validateResolutionEvidencePayload(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }

  const { response_payload, response_status, response_headers, resolved_at } = body;
  if (typeof response_payload !== "string") {
    return "response_payload must be a string";
  }
  if (
    !Number.isInteger(response_status) ||
    response_status < 100 ||
    response_status > 599
  ) {
    return "response_status must be an integer between 100 and 599";
  }
  if (
    response_headers === null ||
    typeof response_headers !== "object" ||
    Array.isArray(response_headers) ||
    Object.entries(response_headers).some(
      ([name, value]) =>
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        typeof value !== "string",
    )
  ) {
    return "response_headers must be an object of string values";
  }
  if (
    typeof resolved_at !== "string" ||
    !Number.isFinite(Date.parse(resolved_at))
  ) {
    return "resolved_at must be a valid timestamp";
  }

  return null;
}

function normalizeSubmissionId(value) {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return value.replace(/^0+(?=\d)/, "");
}

export function createApp() {
  marketCacheManager.start();
  const app = express();
  let distinctFunctionsCache = null;
  app.use(securityHeaders);
  app.use(createCorsMiddleware());
  app.use(express.json());

  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").send(renderMetrics());
  });

  registerOracleRoutes(app, requireAdminKey, asyncHandler);

  // GET /health — liveness + readiness probe for container orchestrators and uptime monitors
  app.get(
    "/health",
    asyncHandler(async (req, res) => {
      const LAG_ALERT_THRESHOLD_S = Number(process.env.LAG_ALERT_THRESHOLD_S || 30);
      const now = Date.now();
      const uptimeSeconds = Math.floor((now - health.startedAt) / 1000);

      const dbConnected = await db.ping();

      let lagSeconds = null;
      if (health.lastIndexedAt !== null) {
        lagSeconds = Math.floor((now - health.lastIndexedAt) / 1000);
      }

      if (!dbConnected) {
        return res.status(503).json({
          status: "error",
          db: "disconnected",
          uptime_seconds: uptimeSeconds,
          lag_seconds: lagSeconds,
          last_ledger: health.lastLedger,
          last_indexed_at: health.lastIndexedAt
            ? new Date(health.lastIndexedAt).toISOString()
            : null,
        });
      }

      const degraded = lagSeconds !== null && lagSeconds > LAG_ALERT_THRESHOLD_S;
      const status = degraded ? "degraded" : "ok";

      const body = {
        status,
        db: "connected",
        uptime_seconds: uptimeSeconds,
        lag_seconds: lagSeconds,
        last_ledger: health.lastLedger,
        last_indexed_at: health.lastIndexedAt ? new Date(health.lastIndexedAt).toISOString() : null,
        pool: typeof db.getPoolMetrics === "function" ? db.getPoolMetrics() : undefined,
      };

      res.status(degraded ? 503 : 200).json(body);
    })
  );

  // GET /ready — readiness check for Kubernetes probes
  app.get(
    "/ready",
    asyncHandler(async (req, res) => {
      const dbConnected = await db.ping();
      if (!dbConnected) {
        return res.status(503).json({ status: "error", db: "disconnected" });
      }
      res.status(200).json({ status: "ok", db: "connected", last_ledger: health.lastLedger });
    })
  );

  // Rate limiter applies to /api/* routes to protect endpoints against DoS while exempting /health and /ready probes
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Legacy route redirect middleware: redirects /api/* (except /api/v1/*) to /api/v1/* with HTTP 301 (issue #965)
  app.use((req, res, next) => {
    const url = req.originalUrl || req.url;
    if (url.startsWith("/api") && !url.startsWith("/api/v1/") && url !== "/api/v1") {
      const target = url.replace(/^\/api(?=\/|\?|$)/, "/api/v1");
      return res.redirect(301, target);
    }
    next();
  });

  const v1Router = express.Router();

  // GET /api/v1/functions — distinct function names across all events
  v1Router.get(
    "/functions",
    asyncHandler(async (req, res) => {
      const now = Date.now();
      const cacheIsFresh =
        distinctFunctionsCache !== null && distinctFunctionsCache.expiresAt > now;

      if (cacheIsFresh) {
        res.setHeader("Cache-Control", "public, max-age=60");
        return res.json(distinctFunctionsCache.value);
      }

      const result = await db.getDistinctFunctions();
      distinctFunctionsCache = {
        value: result,
        expiresAt: now + 60_000,
      };
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json(result);
    })
  );

  // GET /api/v1/oracle/disputes — active disputes and current council votes
  app.get(
    "/api/v1/oracle/disputes",
    asyncHandler(async (_req, res) => {
      if (!process.env.ORACLE_CONTRACT_ID) {
        return res.status(503).json({ error: "Oracle contract is not configured" });
      }

      const rows = await oracleDisputes.fetchActive();
      res.setHeader("Cache-Control", "no-store");
      return res.json({ disputes: formatOracleDisputes(rows) });
    })
  );

  // GET /api/v1/oracle/submissions?status= and /:marketId — Redis-cached 10s (issue #1139)
  const SUBMISSION_STATUSES = ["pending", "challenged", "finalized"];
  const cachedJson = async (key, load) => {
    const redis = getRedis();
    try {
      const hit = await redis?.get(key);
      if (hit) return JSON.parse(hit);
    } catch {
      /* cache miss on Redis failure */
    }
    const value = await load();
    redis?.set(key, JSON.stringify(value), "EX", 10).catch(() => {});
    return value;
  };

  app.get(
    "/api/v1/oracle/submissions",
    asyncHandler(async (req, res) => {
      const status = req.query.status || null;
      if (status && !SUBMISSION_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: `status must be one of: ${SUBMISSION_STATUSES.join(", ")}` });
      }
      const submissions = await cachedJson(`oracle:submissions:${status ?? "all"}`, () =>
        db.getOracleSubmissions({ status })
      );
      res.setHeader("Cache-Control", "public, max-age=10");
      return res.json({ submissions });
    })
  );

  app.get(
    "/api/v1/oracle/submissions/:marketId",
    asyncHandler(async (req, res) => {
      const { marketId } = req.params;
      const submission = await cachedJson(`oracle:submission:${marketId}`, () =>
        db.getLatestOracleSubmission(marketId)
      );
      if (!submission) {
        return res.status(404).json({ error: "Oracle submission not found" });
      }
      res.setHeader("Cache-Control", "public, max-age=10");
      return res.json(submission);
    })
  );

  // POST /api/v1/oracle/resolutions/:submissionId/evidence — record source evidence
  app.post(
    "/api/v1/oracle/resolutions/:submissionId/evidence",
    requireAdminKey,
    asyncHandler(async (req, res) => {
      const submissionId = normalizeSubmissionId(req.params.submissionId);
      if (submissionId === null) {
        return res.status(400).json({ error: "submissionId must be a non-negative integer" });
      }

      const validationError = validateResolutionEvidencePayload(req.body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      try {
        const record = await db.createResolutionAuditLog({
          submission_id: submissionId,
          response_payload: req.body.response_payload,
          response_status: req.body.response_status,
          response_headers: req.body.response_headers,
          resolved_at: new Date(req.body.resolved_at).toISOString(),
        });
        res.setHeader("Cache-Control", "no-store");
        return res.status(201).json(record);
      } catch (error) {
        if (error.code === "RESOLUTION_AUDIT_CONFLICT") {
          return res.status(409).json({ error: error.message });
        }
        throw error;
      }
    })
  );

  // GET /api/v1/oracle/resolutions/:submissionId/evidence — publicly verify evidence
  app.get(
    "/api/v1/oracle/resolutions/:submissionId/evidence",
    asyncHandler(async (req, res) => {
      const submissionId = normalizeSubmissionId(req.params.submissionId);
      if (submissionId === null) {
        return res.status(400).json({ error: "submissionId must be a non-negative integer" });
      }

      const record = await db.getResolutionAuditLog(submissionId);
      if (!record) {
        return res.status(404).json({ error: "Resolution evidence not found" });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json(record);
    })
  );

  // GET /api/tokens/:id/metadata — SEP-41 token metadata from simulated calls
  app.get(
    "/api/tokens/:id/metadata",
    asyncHandler(async (req, res) => {
      let metadata;
      try {
        metadata = await fetchTokenMetadata(req.params.id);
      } catch {
        return res.status(404).json({ error: "Contract is not SEP-41 compliant" });
      }

      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.json({ contract_id: req.params.id, ...metadata });
    })
  );

  // GET /api/v1/leaderboard?limit=10&cursor= — top contracts by event volume (issue #966)
  v1Router.get(
    "/leaderboard",
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
      const cursor = req.query.cursor || null;
      const page = Number(req.query.page) || 1;
      const result = await db.getLeaderboard({ limit, cursor, page });
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(result);
    })
  );

  // GET /api/v1/markets?limit=&cursor=&page= — prediction markets cursor pagination (issue #966)
  // Sets ETag + Cache-Control for HTTP caching (issue #1143)
  v1Router.get(
    "/markets",
    asyncHandler(async (req, res) => {
      const sortParams = parseSortParams(req.query);
      if (!sortParams.ok) {
        return res.status(400).json({ error: sortParams.error });
      }
      const limit = Number(req.query.limit) || 20;
      const cursor = req.query.cursor || null;
      const page = Number(req.query.page) || 1;
      const result = await db.getMarkets({ limit, cursor, page });

      // Compute a list-level ETag from the returned market rows.
      const items = result.markets ?? result.items ?? [];
      const etag = computeListETag(items);

      res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");

      if (etag) {
        res.setHeader("ETag", etag);
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch && ifNoneMatch === etag) {
          return res.status(304).end();
        }
      }

      res.json(result);
    })
  );

  // GET /api/v1/markets/:id — market details with Redis caching (issue #968)
  // Adds ETag + If-None-Match + Cache-Control for HTTP caching (issue #1143)
  v1Router.get(
    "/markets/:id",
    asyncHandler(async (req, res) => {
      const market = await marketCacheManager.getMarket(req.params.id, () =>
        db.getMarket(req.params.id)
      );
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const etag = computeWeakETag(market);
      res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");

      if (etag) {
        res.setHeader("ETag", etag);
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch && ifNoneMatch === etag) {
          return res.status(304).end();
        }
      }

      res.json(market);
    })
  );

  // GET /api/v1/markets/:id/odds — fresh odds with immediate Redis cache invalidation support (issue #968)
  v1Router.get(
    "/markets/:id/odds",
    asyncHandler(async (req, res) => {
      const odds = await marketCacheManager.getMarketOdds(req.params.id, () =>
        db.getMarketOdds(req.params.id)
      );
      if (!odds) {
        return res.status(404).json({ error: "Odds not found for market" });
      }
      res.json({ market_id: req.params.id, odds });
    })
  );

  // POST /api/v1/events/bet-placed — process BetPlaced event with <100ms cache invalidation & pre-warming (issue #968)
  v1Router.post(
    "/events/bet-placed",
    asyncHandler(async (req, res) => {
      const result = await marketCacheManager.handleBetPlacedEvent(req.body);
      await publish(BET_PLACED_CHANNEL, req.body);
      res.status(200).json(result);
    })
  );

  // GET /api/v1/oracle/circuit-breaker — circuit breaker and automated resolution status (issue #958)
  v1Router.get(
    "/oracle/circuit-breaker",
    asyncHandler(async (req, res) => {
      res.json(bondEscrowWorker.getCircuitBreakerStatus());
    })
  );

  // POST /api/v1/oracle/audit-bonds — run bond escrow invariant verification worker (issue #958)
  v1Router.post(
    "/oracle/audit-bonds",
    asyncHandler(async (req, res) => {
      const balance =
        req.body?.contract_balance !== undefined ? req.body.contract_balance : null;
      const report = await bondEscrowWorker.verifyEscrowInvariant({
        contractBalance: balance,
      });
      const status = report.valid ? 200 : 409;
      res.status(status).json(report);
    })
  );

  // GET /api/v1/disputes/bonds — list dispute bonds and aggregate escrow accounting (issue #958)
  v1Router.get(
    "/disputes/bonds",
    asyncHandler(async (req, res) => {
      const { dispute_id, status } = req.query;
      const bonds = await db.getDisputeBonds({ dispute_id, status });
      const accounting = await db.getBondAccounting();
      res.json({ bonds, accounting });
    })
  );

  // POST /api/v1/disputes/bonds — record deposited dispute bond (issue #958)
  v1Router.post(
    "/disputes/bonds",
    requireAdminKey,
    asyncHandler(async (req, res) => {
      const { id, dispute_id, market_id, bond_type, depositor, amount } = req.body;
      if (!id || !dispute_id || !bond_type || !depositor || !amount) {
        return res.status(400).json({ error: "Missing required dispute bond fields" });
      }
      const bond = await db.recordDisputeBond({
        id,
        dispute_id,
        market_id,
        bond_type,
        depositor,
        amount,
      });
      res.status(201).json(bond);
    })
  );

  // POST /api/v1/disputes/bonds/:id/settle — settle dispute bond (issue #958)
  v1Router.post(
    "/disputes/bonds/:id/settle",
    requireAdminKey,
    asyncHandler(async (req, res) => {
      const { status = "settled", settled_amount } = req.body;
      if (settled_amount === undefined) {
        return res.status(400).json({ error: "settled_amount is required" });
      }
      const settled = await db.settleDisputeBond({
        id: req.params.id,
        status,
        settled_amount,
      });
      if (!settled) {
        return res.status(404).json({ error: "Dispute bond not found" });
      }
      res.json(settled);
    })
  );

  // GET /api/v1/bets?market_id=&limit=&cursor=&page= — bets cursor pagination (issue #966)
  v1Router.get(
    "/bets",
    asyncHandler(async (req, res) => {
      const limit = Number(req.query.limit) || 20;
      const cursor = req.query.cursor || null;
      const page = Number(req.query.page) || 1;
      const market_id = req.query.market_id || null;
      const result = await db.getBets({ market_id, limit, cursor, page });
      res.json(result);
    })
  );

  // GET /api/v1/events?contract=&fn=&page=&limit=&cursor=&q= — events cursor pagination (issue #966)
  v1Router.get(
    "/events",
    asyncHandler(async (req, res) => {
      const result = await db.getEvents({
        contract: req.query.contract,
        fn: req.query.fn,
        q: req.query.q,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 25,
        cursor: req.query.cursor || null,
      });
      res.json(result);
    })
  );


  // Live market SSE streams (issue #1147)
  registerMarketStream(v1Router);

  // GET /api/v1/markets/:id/stream — Server-Sent Events endpoint for live odds/pool/bet updates (issue #1173)
  v1Router.get("/markets/:id/stream", (req, res) => {
    const marketId = String(req.params.id).trim();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const matchesMarket = (payload) => {
      if (!payload || typeof payload !== "object") {
        return false;
      }
      const candidate =
        payload.market_id ?? payload.marketId ?? payload.contractId ?? payload.contract_id;
      return candidate === undefined || candidate === null || String(candidate) === marketId;
    };

    const writeFrame = (eventName, payload) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    writeFrame("connected", { type: "connected", market_id: marketId, timestamp: Date.now() });

    const onMarketUpdate = (update) => {
      if (!matchesMarket(update)) {
        return;
      }
      writeFrame("market_update", update);
    };

    const onBetPlaced = (payload) => {
      if (!matchesMarket(payload)) {
        return;
      }
      writeFrame("bet_placed", payload);
    };

    const heartbeatTimer = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    eventEmitter.on("market_update", onMarketUpdate);
    eventEmitter.on("bet_placed", onBetPlaced);
    eventEmitter.on(BET_PLACED_CHANNEL, onBetPlaced);

    res.on("close", () => {
      clearInterval(heartbeatTimer);
      eventEmitter.off("market_update", onMarketUpdate);
      eventEmitter.off("bet_placed", onBetPlaced);
      eventEmitter.off(BET_PLACED_CHANNEL, onBetPlaced);
    });
  });


  // GET /api/v1/events/stream — Server-Sent Events endpoint for live event feed
  v1Router.get("/events/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const onEvent = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventEmitter.on("event", onEvent);

    res.on("close", () => {
      eventEmitter.off("event", onEvent);
    });
  });


  // GET /api/markets/stream - Server-Sent Events endpoint for real-time market updates
  // Eliminates 3-5 second polling latency and conserves bandwidth on static markets
  app.get("/api/markets/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const targetContract = req.query.contract ? String(req.query.contract).trim() : null;
    const targetMarket = req.query.market_id ? String(req.query.market_id).trim() : null;

    const matchesFilter = (payload) => {
      if (!payload || typeof payload !== "object") {
        return false;
      }
      if (targetContract && payload.contractId && payload.contractId !== targetContract) {
        return false;
      }
      if (targetMarket) {
        const candidate =
          payload.market_id ?? payload.marketId ?? payload.contractId ?? payload.contract_id;
        if (candidate !== undefined && candidate !== null && String(candidate) !== targetMarket) {
          return false;
        }
      }
      return true;
    };

    // Send initial connection ack
    res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);

    const onMarketUpdate = (update) => {
      if (!matchesFilter(update)) {
        return;
      }
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    };

    const onBetPlaced = (payload) => {
      if (!matchesFilter(payload)) {
        return;
      }
      res.write(`event: bet_placed\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    // Heartbeat to keep connection alive without pushing redundant static market data
    const heartbeatTimer = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    eventEmitter.on("market_update", onMarketUpdate);
    eventEmitter.on("bet_placed", onBetPlaced);
    eventEmitter.on(BET_PLACED_CHANNEL, onBetPlaced);

    res.on("close", () => {
      clearInterval(heartbeatTimer);
      eventEmitter.off("market_update", onMarketUpdate);
      eventEmitter.off("bet_placed", onBetPlaced);
      eventEmitter.off(BET_PLACED_CHANNEL, onBetPlaced);
    });
  });
  // GET /api/events/:seq/raw — raw un-decoded topics and data for a single event.
  // Must be registered BEFORE /api/events/:seq so Express doesn't consume "raw"
  // as the :seq parameter.
  app.get(
    "/api/events/:seq/raw",
    asyncHandler(async (req, res) => {
      const seqStr = String(req.params.seq).trim();
      const seq = parseInt(seqStr, 10);
      if (isNaN(seq) || seq < 0 || !/^\d+$/.test(seqStr)) {
        return res.status(400).json({ error: "seq must be a non-negative integer" });
      }
      const ev = await db.getEvent(seq);
      if (!ev) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json({
        seq: ev.seq,
        raw_topics: ev.raw_topics,
        raw_data: ev.raw_data,
        tx_hash: ev.tx_hash,
      });
    })
  );

  // GET /api/v1/events/:seq — single event by sequence number
  v1Router.get(
    "/events/:seq",
    asyncHandler(async (req, res) => {
      const seqStr = String(req.params.seq).trim();
      const seq = parseInt(seqStr, 10);
      if (isNaN(seq) || seq < 0 || !/^\d+$/.test(seqStr)) {
        return res.status(400).json({ error: "seq must be a non-negative integer" });
      }
      const ev = await db.getEvent(seq);
      if (!ev) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json(ev);
    })
  );

  // GET /api/v1/contracts?q=&page=&limit= — paginated list of registered contracts
  v1Router.get(
    "/contracts",
    asyncHandler(async (req, res) => {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 25;
      const result = await db.getContracts({ q: req.query.q, page, limit });
      res.json(result);
    })
  );

  // GET /api/v1/contracts/:id/events?fn=&page= — paginated event history for contract
  v1Router.get(
    "/contracts/:id/events",
    asyncHandler(async (req, res) => {
      const meta = await db.getContractMeta(req.params.id);
      if (!meta) {
        return res.status(404).json({ error: "Not found" });
      }
      const result = await db.getEvents({
        contract: req.params.id,
        fn: req.query.fn,
        page: Number(req.query.page) || 1,
      });
      res.json(result);
    })
  );

  // GET /api/v1/contracts/:id
  v1Router.get(
    "/contracts/:id",
    asyncHandler(async (req, res) => {
      const meta = await db.getContractMeta(req.params.id);
      if (!meta) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json(meta);
    })
  );

  // POST /api/v1/contracts — register contract ABI metadata
  v1Router.post(
    "/contracts",
    requireAdminKey,
    asyncHandler(async (req, res) => {
      const validationError = validateContractPayload(req.body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const existing = await db.getContractMeta(req.body.id);
      const registeredBy = req.body.registered_by ?? existing?.registered_by;

      if (existing?.registered_by && !registeredBy) {
        return res
          .status(400)
          .json({ error: "registered_by is required to update contract metadata" });
      }

      await db.upsertContractMeta({ ...req.body, registered_by: registeredBy });
      res.status(201).json({ ok: true });
    })
  );

  // POST /api/oracle/attestations — submit and verify off-chain oracle signed payload
  // Enforces domain separation, freshness window (< 5m), cryptographic signature verification,
  // and replay attack defense via database unique constraint on (provider_id, nonce).
  const handleOracleAttestation = asyncHandler(async (req, res) => {
    try {
      const result = await verifyAndConsumeOracleAttestation(req.body);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OracleVerificationError) {
        return res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
        });
      }
      throw err;
    }
  });

  app.post("/api/oracle/attestations", handleOracleAttestation);
  app.post("/api/oracle/attestation", handleOracleAttestation);

  return app;
}

export function startApi() {
  return createApp().listen(PORT, () => {
    console.log(`[api] listening on ${PORT}`);
  });
}
