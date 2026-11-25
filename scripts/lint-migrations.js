#!/usr/bin/env node
// Migration linter (issue #1156). Plain Node, no dependencies.
// Usage: node scripts/lint-migrations.js [migrations-dir]   (default: indexer/migrations)
// Rules:
//   1. Filename matches NNNN_snake_case.sql
//   2. Prefixes are unique and contiguous, starting from the first file's prefix
//   3. DROP TABLE / DROP COLUMN / TRUNCATE / ALTER COLUMN ... TYPE need a
//      `-- lint:allow-destructive` comment in the file
//   4. CREATE TABLE/INDEX must use IF NOT EXISTS
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const ALLOW_MARKER = "-- lint:allow-destructive";
const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [/\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i, "ALTER COLUMN TYPE"],
];
const NON_IDEMPOTENT = [
  [/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/i, "CREATE TABLE without IF NOT EXISTS"],
  [/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?!IF\s+NOT\s+EXISTS\b)/i, "CREATE INDEX without IF NOT EXISTS"],
];

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

export function lintMigrations(dir) {
  const errors = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let prev = null;
  const seen = new Map();
  for (const file of files) {
    const m = NAME_RE.exec(file);
    if (!m) {
      errors.push(`${file}: filename must match NNNN_snake_case.sql`);
      continue;
    }
    const n = Number(m[1]);
    if (seen.has(n)) {
      errors.push(`${file}: duplicate prefix ${m[1]} (also ${seen.get(n)})`);
    } else {
      if (prev !== null && n !== prev + 1) {
        errors.push(`${file}: expected prefix ${String(prev + 1).padStart(4, "0")} (gap or out-of-order)`);
      }
      seen.set(n, file);
    }
    prev = n;

    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const sql = stripComments(raw);
    if (!raw.includes(ALLOW_MARKER)) {
      for (const [re, label] of DESTRUCTIVE) {
        if (re.test(sql)) errors.push(`${file}: ${label} requires '${ALLOW_MARKER}'`);
      }
    }
    for (const [re, label] of NON_IDEMPOTENT) {
      if (re.test(sql)) errors.push(`${file}: ${label}`);
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || "indexer/migrations";
  const errors = lintMigrations(dir);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  console.log(`migrations OK (${dir})`);
}
