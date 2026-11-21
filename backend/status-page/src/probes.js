/**
 * Automated health probes for every public-facing PERO-J component.
 *
 * Each probe resolves to a ProbeResult and never throws — network failures are
 * converted into a `major_outage` status so a single broken dependency can't
 * take the status page down with it.
 *
 * @typedef {"operational" | "degraded" | "major_outage" | "unknown"} ComponentStatus
 *
 * @typedef {Object} ProbeResult
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {ComponentStatus} status
 * @property {number|null} latencyMs
 * @property {string} message
 * @property {Record<string, unknown>} details
 * @property {string} checkedAt ISO timestamp
 */

export const STATUS = Object.freeze({
  OPERATIONAL: "operational",
  DEGRADED: "degraded",
  MAJOR_OUTAGE: "major_outage",
  UNKNOWN: "unknown",
});

const SEVERITY = {
  [STATUS.OPERATIONAL]: 0,
  [STATUS.UNKNOWN]: 1,
  [STATUS.DEGRADED]: 2,
  [STATUS.MAJOR_OUTAGE]: 3,
};

/** Return the worst of the supplied statuses. */
export function worstStatus(statuses) {
  return statuses.reduce(
    (worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst),
    STATUS.OPERATIONAL
  );
}

/**
 * fetch() with a hard timeout and latency measurement.
 * @returns {Promise<{ ok: boolean, status: number, body: any, latencyMs: number }>}
 */
export async function timedFetch(url, { timeoutMs, method = "GET", body, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetchImpl(url, {
      method,
      signal: controller.signal,
      headers: body ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { ok: res.ok, status: res.status, body: parsed, latencyMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

function result(base, fields) {
  return {
    latencyMs: null,
    message: "",
    details: {},
    ...base,
    ...fields,
    checkedAt: new Date().toISOString(),
  };
}

function failure(base, err) {
  const reason = err?.name === "AbortError" ? "Probe timed out" : `Probe failed: ${err?.message ?? err}`;
  return result(base, { status: STATUS.MAJOR_OUTAGE, message: reason });
}

function latencyStatus(latencyMs, cfg) {
  return latencyMs > cfg.thresholds.latencyDegradedMs ? STATUS.DEGRADED : STATUS.OPERATIONAL;
}

/**
 * Synthetic frontend uptime probe.
 *
 * Verifies the public frontend `/health` endpoint returns HTTP 200 from an
 * external vantage point and fires an alert when the response time exceeds the
 * configured budget (default 2.5s). Intended to run on a 30s interval.
 */
export async function probeFrontend(cfg, fetchImpl = fetch) {
  const base = {
    id: "frontend",
    name: "Frontend Web App",
    description: "Public web application served to end users via CDN.",
  };
  if (!cfg.frontendUrl) {
    return result(base, { status: STATUS.UNKNOWN, message: "Frontend health endpoint not configured (FRONTEND_URL)" });
  }
  const alertThresholdMs = cfg.thresholds.frontendAlertMs ?? 2500;
  try {
    const res = await timedFetch(`${cfg.frontendUrl.replace(/\/$/, "")}/health`, {
      timeoutMs: cfg.probeTimeoutMs,
      fetchImpl,
    });
    const details = {
      httpStatus: res.status,
      alertThresholdMs,
      alert: false,
    };

    if (!res.ok || res.status !== 200) {
      return result(base, {
        status: STATUS.MAJOR_OUTAGE,
        latencyMs: res.latencyMs,
        message: `Frontend /health returned HTTP ${res.status}`,
        details: { ...details, alert: true },
      });
    }

    if (res.latencyMs > alertThresholdMs) {
      return result(base, {
        status: STATUS.DEGRADED,
        latencyMs: res.latencyMs,
        message: `Frontend response time ${res.latencyMs}ms exceeds ${alertThresholdMs}ms budget`,
        details: { ...details, alert: true },
      });
    }

    return result(base, {
      status: latencyStatus(res.latencyMs, cfg),
      latencyMs: res.latencyMs,
      message: `Frontend healthy (${res.latencyMs}ms)`,
      details,
    });
  } catch (err) {
    return failure(base, err);
  }
}

/** Stellar Horizon + Soroban RPC node. */
export async function probeStellar(cfg, fetchImpl = fetch) {
  const base = {
    id: "stellar-rpc",
    name: "Stellar Horizon / RPC Node",
    description: "Network gateway used to submit transactions and read ledger state.",
  };
  try {
    const [horizon, rpc] = await Promise.allSettled([
      timedFetch(cfg.horizonUrl, { timeoutMs: cfg.probeTimeoutMs, fetchImpl }),
      timedFetch(cfg.rpcUrl, {
        timeoutMs: cfg.probeTimeoutMs,
        method: "POST",
        body: { jsonrpc: "2.0", id: 1, method: "getHealth" },
        fetchImpl,
      }),
    ]);

    const statuses = [];
    const details = {};
    const notes = [];

    if (horizon.status === "fulfilled" && horizon.value.ok) {
      const h = horizon.value;
      details.horizonLatencyMs = h.latencyMs;
      details.horizonLatestLedger = h.body?.history_latest_ledger ?? null;
      const closedAt = h.body?.history_latest_ledger_closed_at;
      if (closedAt) {
        const staleS = Math.round((Date.now() - Date.parse(closedAt)) / 1000);
        details.horizonLedgerAgeS = staleS;
        if (staleS > cfg.thresholds.rpcLedgerStaleS) {
          statuses.push(STATUS.DEGRADED);
          notes.push(`Horizon ledger is ${staleS}s old`);
        }
      }
      statuses.push(latencyStatus(h.latencyMs, cfg));
    } else {
      statuses.push(STATUS.MAJOR_OUTAGE);
      notes.push("Horizon unreachable");
    }

    if (rpc.status === "fulfilled" && rpc.value.ok && rpc.value.body?.result) {
      const r = rpc.value;
      details.rpcLatencyMs = r.latencyMs;
      details.rpcHealth = r.body.result.status ?? null;
      details.rpcLatestLedger = r.body.result.latestLedger ?? null;
      if (r.body.result.status && r.body.result.status !== "healthy") {
        statuses.push(STATUS.DEGRADED);
        notes.push(`RPC reports "${r.body.result.status}"`);
      }
      statuses.push(latencyStatus(r.latencyMs, cfg));
    } else {
      statuses.push(STATUS.MAJOR_OUTAGE);
      notes.push("Soroban RPC unreachable");
    }

    // Partial outage (only one of the two endpoints down) is surfaced as degraded.
    let status = worstStatus(statuses);
    const bothDown = notes.includes("Horizon unreachable") && notes.includes("Soroban RPC unreachable");
    if (status === STATUS.MAJOR_OUTAGE && !bothDown) status = STATUS.DEGRADED;

    const latencies = [details.horizonLatencyMs, details.rpcLatencyMs].filter((v) => typeof v === "number");
    return result(base, {
      status,
      latencyMs: latencies.length ? Math.max(...latencies) : null,
      message: notes.length ? notes.join("; ") : "All systems operational",
      details,
    });
  } catch (err) {
    return failure(base, err);
  }
}

/** Chain indexer & event processing — uses the indexer's /health lag report. */
export async function probeIndexer(cfg, fetchImpl = fetch) {
  const base = {
    id: "indexer",
    name: "Chain Indexer & Event Processing",
    description: "Ingests contract events from the ledger and keeps the database in sync.",
  };
  try {
    const res = await timedFetch(`${cfg.indexerUrl.replace(/\/$/, "")}/health`, {
      timeoutMs: cfg.probeTimeoutMs,
      fetchImpl,
    });
    const body = res.body && typeof res.body === "object" ? res.body : {};
    const lag = typeof body.lag_seconds === "number" ? body.lag_seconds : null;
    const details = {
      lagSeconds: lag,
      lastLedger: body.last_ledger ?? null,
      lastIndexedAt: body.last_indexed_at ?? null,
      db: body.db ?? null,
    };

    if (body.db === "disconnected") {
      return result(base, { status: STATUS.MAJOR_OUTAGE, latencyMs: res.latencyMs, message: "Indexer database disconnected", details });
    }
    if (lag !== null && lag > cfg.thresholds.indexerLagOutageS) {
      return result(base, { status: STATUS.MAJOR_OUTAGE, latencyMs: res.latencyMs, message: `Indexer is ${lag}s behind the chain`, details });
    }
    if ((lag !== null && lag > cfg.thresholds.indexerLagDegradedS) || body.status === "degraded") {
      return result(base, { status: STATUS.DEGRADED, latencyMs: res.latencyMs, message: `Indexer lagging (${lag ?? "?"}s)`, details });
    }
    if (!res.ok) {
      return result(base, { status: STATUS.MAJOR_OUTAGE, latencyMs: res.latencyMs, message: `Indexer returned HTTP ${res.status}`, details });
    }
    return result(base, {
      status: latencyStatus(res.latencyMs, cfg),
      latencyMs: res.latencyMs,
      message: lag === null ? "Indexer online, awaiting first ledger" : `In sync (lag ${lag}s)`,
      details,
    });
  } catch (err) {
    return failure(base, err);
  }
}

/** Optimistic oracle resolver workers. */
export async function probeOracle(cfg, fetchImpl = fetch) {
  const base = {
    id: "oracle",
    name: "Optimistic Oracle Resolvers",
    description: "Proposes, disputes, and finalizes market outcomes.",
  };
  if (!cfg.oracleUrl) {
    return result(base, { status: STATUS.UNKNOWN, message: "Oracle health endpoint not configured (ORACLE_URL)" });
  }
  try {
    const res = await timedFetch(`${cfg.oracleUrl.replace(/\/$/, "")}/health`, { timeoutMs: cfg.probeTimeoutMs, fetchImpl });
    const body = res.body && typeof res.body === "object" ? res.body : {};
    const details = {
      activeResolvers: body.active_resolvers ?? body.activeR