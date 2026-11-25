# `npm run migrate:status`

Run from `indexer/` with `DATABASE_URL` set. Prints a table of migrations and exits `1` if any are pending (usable as a deployment health check), `0` if none, `2` on error.

What it reports:

- **Inline migrations** (the `migrations` array in `indexer/src/db.js`, applied by `db.init()` / `npm run migrate`) are compared with the `schema_migrations (id, name, applied_at)` table: `applied` (with timestamp) or `pending`. Rows in `schema_migrations` that are no longer in code show as `applied (not in code)`.
- **`indexer/migrations/*.sql` files** are listed as `untracked`. The runner does not read or record them, so they cannot be reported as applied or pending; they do not affect the exit code.

The inline array is not exported, so the script parses `id: N, name: "..."` pairs from the `db.js` source. If that array format changes, update the regex in `indexer/scripts/migrate-status.js`.

The issue text mentions `db/status.ts` and `backend/db/migrations/`; those paths do not exist, so the script lives in `indexer/scripts/` as plain Node ESM.
