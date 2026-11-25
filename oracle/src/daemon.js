import http from "node:http";
import pg from "pg";
import {
  getCouncilInactivityConfig,
  startCouncilInactivityMonitor,
} from "./monitors/council-inactivity.ts";
import {
  BondEscrowGuard,
  getBondAuditConfig,
  startBondEscrowAudit,
} from "./workers/bond-escrow-audit.ts";
import { challengeWindowSeconds } from "./challenge-window.js";
import { finalizeUncontestedMarkets } from "./workers/auto-finalizer.js";
import { submitExpiredMarket } from "./workers/auto-submitter.js";

const POLL_MS = Number(process.env.ORACLE_POLL_MS) || 15_000;
const FINALIZE_POLL_MS = Number(process.env.ORACLE_FINALIZE_POLL_MS) || 60_000;
const HEARTBEAT_MS = Number(process.env.ORACLE_HEARTBEAT_MS) || 60_000;
const HEALTH_PORT = Number(process.env.ORACLE_HEALTH_PORT) || 9101;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export const metrics = {
  startedAt: Date.now(),
  lastPollAt: null,
  polls: 0,
  pollErrors: 0,
  marketsSubmitted: 0,
  resolutionHalts: 0,
  lastFinalizeAt: null,
  marketsFinalized: 0,
  finalizeErrors: 0,
};

/**
 * Scan for expired open markets and submit each one, stopping as soon as
 * `canResolve` reports that automated resolution is halted.
 */
export async function pollOnce(
  db = pool,
  submit = submitExpiredMarket,
  canResolve = async () => true,
) {
  const { rows } = await db.query(
    "SELECT id, slug, category, params FROM markets WHERE ends_at <= NOW() AND status = 'open' ORDER BY ends_at",
  );
  for (const market of rows) {
    if (!(await canResolve())) {
      metrics.resolutionHalts++;
      console.error("[oracle] automated resolution halted by bond escrow audit");
      break;
    }
    try {
      if (await submit(db, market, { canResolve })) {
        metrics.marketsSubmitted++;
      }
    } catch (err) {
      metrics.pollErrors++;
      console.error(`[oracle] market ${market.id} failed: ${err.message}`);
    }
  }
  metrics.polls++;
  metrics.lastPollAt = Date.now();
}

/** Finalize uncontested submissions whose challenge window has closed. */
export async function finalizeOnce(
  db = pool,
  finalizeAll = finalizeUncontestedMarkets,
) {
  const { finalized, failed } = await finalizeAll(db);
  metrics.marketsFinalized += finalized;
  metrics.finalizeErrors += failed;
  metrics.lastFinalizeAt = Date.now();
}

async function run() {
  challengeWindowSeconds(); // Refuse to start on an invalid window.
  let stopping = false;
  let timer;
  let finalizeTimer;

  const councilConfig = getCouncilInactivityConfig();
  const stopCouncilMonitor = councilConfig
    ? startCouncilInactivityMonitor({ config: councilConfig })
    : null;
  if (!councilConfig) {
    console.warn(
      "[council-inactivity] disabled: set ORACLE_CONTRACT_ID, PAGERDUTY_ROUTING_KEY and ORACLE_COUNCIL_ROSTER",
    );
  }

  const auditConfig = getBondAuditConfig();
  const guard = auditConfig ? new BondEscrowGuard(pool, auditConfig) : null;
  const stopBondAudit = guard
    ? startBondEscrowAudit(guard, auditConfig.intervalMs)
    : null;
  if (!guard) {
    console.warn(
      "[bond-audit] disabled: set BOND_ESCROW_CONTRACT_ID to protect automated resolution",
    );
  }

  const loop = async () => {
    try {
      await pollOnce(
        pool,
        submitExpiredMarket,
        guard ? () => guard.isResolutionAllowed() : undefined,
      );
    } catch (err) {
      metrics.pollErrors++;
      console.error("[oracle] poll failed:", err.message);
    }
    if (!stopping) {
      timer = setTimeout(loop, POLL_MS);
    }
  };

  // Separate loop so slow data providers cannot delay finalization.
  const finalizeLoop = async () => {
    try {
      await finalizeOnce();
    } catch (err) {
      metrics.finalizeErrors++;
      console.error("[oracle] finalize poll failed:", err.message);
    }
    if (!stopping) {
      finalizeTimer = setTimeout(finalizeLoop, FINALIZE_POLL_MS);
    }
  };

  const heartbeat = setInterval(
    () =>
      console.log(
        JSON.stringify({ event: "heartbeat", ...metrics, ts: Date.now() }),
      ),
    HEARTBEAT_MS,
  );

  const server = http
    .createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/health") {
        res.end(JSON.stringify({
            status: "ok",
            ...metrics,
            bondEscrow: guard?.status ?? null,
          }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    })
    .listen(HEALTH_PORT);

  const shutdown = async (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[oracle] ${signal} received, shutting down`);
    clearTimeout(timer);
    clearTimeout(finalizeTimer);
    clearInterval(heartbeat);
    stopCouncilMonitor?.();
    stopBondAudit?.();
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await Promise.all([loop(), finalizeLoop()]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
