#!/usr/bin/env node
/**
 * Refresh mv_leaderboard_ranks every N seconds (default 60) with
 * REFRESH MATERIALIZED VIEW CONCURRENTLY, so readers are never blocked.
 *
 * Usage (from indexer/, DATABASE_URL set):
 *   node scripts/refresh-leaderboard.js [--interval 60] [--once]
 */
import pg from "pg";

const i = process.argv.indexOf("--interval");
const intervalSec = i === -1 ? 60 : Number(process.argv[i + 1]) || 60;
const once = process.argv.includes("--once");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function refresh() {
  const t = Date.now();
  try {
    await pool.query("SELECT refresh_leaderboard()");
    console.log(`[leaderboard] refreshed in ${Date.now() - t}ms`);
  } catch (err) {
    console.error("[leaderboard] refresh failed:", err.message);
    process.exitCode = 1;
  }
}

await refresh();
if (once) {
  await pool.end();
} else {
  const timer = setInterval(refresh, intervalSec * 1000);
  const stop = async () => {
    clearInterval(timer);
    await pool.end();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
