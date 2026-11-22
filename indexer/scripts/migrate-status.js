/**
 * Print applied vs pending schema migrations.
 *
 * The runner (indexer/src/db.js, db.init()) applies only the inline
 * `migrations` array and records each in `schema_migrations (id, name,
 * applied_at)`. Files in indexer/migrations/*.sql are NOT applied or tracked
 * by the runner, so they are listed separately as "untracked".
 *
 * The inline array is not exported, so it is parsed from the db.js source
 * (`id: N, name: "..."`) to avoid modifying the runner.
 *
 * Exit code: 0 = no pending inline migrations, 1 = pending exist, 2 = error.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
const dbSource = path.join(here, "..", "src", "db.js");
const sqlDir = path.join(here, "..", "migrations");

function inlineMigrations() {
  const src = readFileSync(dbSource, "utf8");
  const out = [];
  const re = /\bid:\s*(\d+),\s*name:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ id: Number(m[1]), name: m[2] });
  return out;
}

async function main() {
  const defined = inlineMigrations();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let applied = new Map();
  try {
    const { rows } = await client.query("SELECT id, name, applied_at FROM schema_migrations");
    applied = new Map(rows.map((r) => [r.id, r]));
  } catch (err) {
    if (err.code !== "42P01") throw err; // table missing: nothing applied yet
  } finally {
    await client.end();
  }

  const rows = defined.map((d) => {
    const a = applied.get(d.id);
    return {
      id: d.id,
      name: d.name,
      status: a ? "applied" : "pending",
      applied_at: a ? new Date(a.applied_at).toISOString() : "-",
    };
  });
  const known = new Set(defined.map((d) => d.id));
  for (const a of applied.values()) {
    if (!known.has(a.id)) {
      rows.push({
        id: a.id,
        name: a.name,
        status: "applied (not in code)",
        applied_at: new Date(a.applied_at).toISOString(),
      });
    }
  }
  for (const f of readdirSync(sqlDir).filter((n) => n.endsWith(".sql")).sort()) {
    rows.push({ id: "-", name: f, status: "untracked (.sql, not run by runner)", applied_at: "-" });
  }

  console.table(rows);
  const pending = rows.filter((r) => r.status === "pending").length;
  console.log(`${pending} pending migration(s).`);
  process.exit(pending > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[migrate:status] failed:", err);
  process.exit(2);
});
