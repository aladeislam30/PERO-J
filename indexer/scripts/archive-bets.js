#!/usr/bin/env node
/**
 * Archive bets of long-resolved markets into bets_archive in batches.
 *
 * Usage (from indexer/, DATABASE_URL set):
 *   node scripts/archive-bets.js [--dry-run] [--months 12] [--batch-size 5000] [--max-batches 0]
 *
 * --dry-run counts eligible rows for one batch and changes nothing.
 * Each batch runs in its own transaction (archive_resolved_bets(), migration 0017).
 */
import pg from "pg";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : Number(process.argv[i + 1]);
}

const dryRun = process.argv.includes("--dry-run");
const months = arg("months", 12);
const batch = arg("batch-size", 5000);
const maxBatches = arg("max-batches", 0); // 0 = unlimited

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  let total = 0;
  for (let n = 1; !maxBatches || n <= maxBatches; n++) {
    const { rows } = await pool.query(
      "SELECT archive_resolved_bets($1, $2, $3) AS moved",
      [months, batch, dryRun]
    );
    const moved = Number(rows[0].moved);
    total += moved;
    console.log(`[archive-bets] batch ${n}: ${moved} rows${dryRun ? " (dry run)" : ""}`);
    if (dryRun || moved < batch) break;
  }
  console.log(`[archive-bets] ${dryRun ? "would archive" : "archived"} ${total} rows`);
} catch (err) {
  console.error("[archive-bets] failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
