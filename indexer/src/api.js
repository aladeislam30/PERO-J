import express from "express";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "./db.js";
import { fetchTokenMetadata } from "./sep41Metadata.js";
import { registerMarketStream } from "./marketStream.js";
import { formatOracleDisputes, oracleDisputes } from "./oracleDisputes.js";
import { emitMarketUpdate } from "./events.js";

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
import { routeRateLimit } from "./routeRateLimit.js";
import { requestIdMiddleware } from "./requestContext.js";
import { httpMetricsMiddleware } from "./middleware/httpMetrics.js";
import { registerOpenApi } from "./openapi.js";

import { renderReferralCard, renderReferralMeta, sanitizeReferralField } from "./referralCard.js";



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
  app.use(requestIdMiddleware); // X-Request-ID + AsyncLocalStorage (#1151)
  app.use(httpMetricsMiddleware); // request metrics + optional /metrics auth (#1152)
  app.use(securityHeaders);
  app.use(createCorsMiddleware());
  app.use(express.json());

  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").send(renderMetrics());
  });

