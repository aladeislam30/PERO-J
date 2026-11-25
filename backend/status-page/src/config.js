/**
 * Runtime configuration for the public status page.
 *
 * Every value can be overridden through environment variables so the same
 * image can be deployed against testnet, staging, or mainnet.
 */

function num(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function list(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  return {
    port: num(env.STATUS_PORT ?? env.PORT, 3005),
    /** How often the automated health probes run (ms). */
    probeIntervalMs: num(env.STATUS_PROBE_INTERVAL_MS, 30_000),
    /** Per-probe request timeout (ms). */
    probeTimeoutMs: num(env.STATUS_PROBE_TIMEOUT_MS, 5_000),
    /** Number of probe samples kept per component for uptime / latency history. */
    historySize: num(env.STATUS_HISTORY_SIZE, 2_880), // 24h at 30s interval

    horizonUrl: env.HORIZON_URL || "https://horizon-testnet.stellar.org",
    rpcUrl: env.RPC_URL || "https://soroban-testnet.stellar.org",
    indexerUrl: env.INDEXER_URL || "http://localhost:3001",
    apiUrl: env.API_URL || env.INDEXER_URL || "http://localhost:3001",
    /** Optional oracle resolver health endpoint. When unset the component reports "unknown". */
    oracleUrl: env.ORACLE_URL || "",

    /**
     * Synthetic probe monitoring (issue #1203).
     *
     * The frontend is probed from external vantage points to verify end-to-end
     * availability (DNS + CDN + app), independent of internal backend health.
     * The Soroban RPC endpoint is probed for response latency from the same
     * external vantage points.
     */
    synthetic: {
      /** Public frontend base URL probed for end-to-end availability. */
      frontendUrl: env.STATUS_FRONTEND_URL || "http://localhost:3000",
      /** Health path appended to the frontend URL; must return HTTP 200. */
      healthPath: env.STATUS_FRONTEND_HEALTH_PATH || "/health",
      /** How often synthetic probes run (ms). Defaults to 30s. */
      intervalMs: num(env.STATUS_SYNTHETIC_INTERVAL_MS, 30_000),
      /** Per-probe request timeout (ms). */
      timeoutMs: num(env.STATUS_SYNTHETIC_TIMEOUT_MS, 5_000),
      /**
       * External vantage points used to probe the frontend and Soroban RPC.
       * Comma-separated labels (e.g. "us-east,eu-west,ap-south"). When empty a
       * single "default" vantage point is used.
       */
      vantagePoints: (env.STATUS_SYNTHETIC_VANTAGES || "default")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      /** Soroban RPC endpoint probed for latency from external vantage points. */
      rpcUrl: env.STATUS_SYNTHETIC_RPC_URL || env.RPC_URL || "https://soroban-testnet.stellar.org",
      /** Frontend response time above which an alert fires (ms). */
      frontendLatencyAlertMs: num(env.STATUS_FRONTEND_LATENCY_ALERT_MS, 2_500),
      /** Soroban RPC response time above which RPC is considered degraded (ms). */
      rpcLatencyDegradedMs: num(env.STATUS_SYNTHETIC_RPC_LATENCY_DEGRADED_MS, 2_000),
    },

    thresholds: {
      /** Latency above which a component is considered degraded (ms). */
      latencyDegradedMs: num(env.STATUS_LATENCY_DEGRADED_MS, 2_000),
      /** Indexer lag above which the indexer is degraded (s). */
      indexerLagDegradedS: num(env.LAG_ALERT_THRESHOLD_S, 30),
      /** Indexer lag above which the indexer is considered a major outage (s). */
      indexerLagOutageS: num(env.STATUS_INDEXER_LAG_OUTAGE_S, 300),
      /** RPC ledger staleness above which RPC is degraded (s). */
      rpcLedgerStaleS: num(env.STATUS_RPC_LEDGER_STALE_S, 60),
    },

    /** Path to the incident post-mortem log (JSON). */
    incidentsFile: env.STATUS_INCIDENTS_FILE || new URL("../incidents.json", import.meta.url).pathname,
    /** Optional maintenance banner shown on the page. */
    maintenanceMessage: env.STATUS_MAINTENANCE_MESSAGE || "",

    /**
     * Browser security policy (issue #1208).
     *
     * `corsOrigins` is a strict allowlist of frontend origins permitted to make
     * cross-origin requests. `csp` restricts script and connect sources to the
     * trusted domains the status page actually talks to. HSTS enforces HTTPS
     * for one year with preload, and framing / MIME sniffing are disabled.
     */
    security: {
      corsOrigins: list(env.STATUS_CORS_ORIGINS, [
        "https://status.stellar.org",
        "https://app.stellar.org",
      ]),
      csp: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: [
          "'self'",
          env.HORIZON_URL || "https://horizon-testnet.stellar.org",
          env.RPC_URL || "https://soroban-testnet.stellar.org",
          env.API_URL || env.INDEXER_URL || "http://localhost:3001",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
      hsts: {
        maxAge: 31_536_000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      frameguard: "deny",
      noSniff: true,
    },
  };
}
