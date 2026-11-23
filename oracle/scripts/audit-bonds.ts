/**
 * One-shot bond escrow audit. Exits 0 when the invariant holds, 1 otherwise.
 * A violation trips the shared circuit breaker. With --reset, a tripped breaker
 * is cleared, but only if the audit passes.
 */
import pg from "pg";
import {
  BondEscrowGuard,
  getBondAuditConfig,
} from "../src/workers/bond-escrow-audit.ts";

const config = getBondAuditConfig();
if (!config) {
  console.error("BOND_ESCROW_CONTRACT_ID is not configured");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const guard = new BondEscrowGuard(pool, config);
  const result = process.argv.includes("--reset")
    ? await guard.reset()
    : await guard.check();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
} catch (err) {
  console.error("[bond-audit] audit could not complete:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
