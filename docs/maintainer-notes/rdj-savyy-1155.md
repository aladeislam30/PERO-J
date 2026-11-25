# Note to maintainers: issue #1155 (duplicate migration prefix 0008)

On current `main` there is no duplicate prefix to fix. `db/` contains only
connection helpers (no `migrate.ts`, no `0008_*` files), and
`indexer/migrations/` holds a single file, `0015_create_checkpoint_state.sql`.
The files named in the issue (`0008_council_votes.sql`,
`0008_extend_oracle_submissions.sql`, `0009_oracle_disputes.sql`) do not exist
in this tree, so no renumbering was performed.

Existing migrations were deliberately NOT renumbered: other open work builds on
`0015` (e.g. `0016`-`0018` and later), and renaming applied files would break
deployments that track migrations by filename.

To prevent the problem from (re)appearing, `scripts/lint-migrations.js` (issue
#1156) fails CI on duplicate prefixes, gaps and out-of-order numbers.

Related observation: `indexer/src/db.js` `init()` applies an inline
`migrations` array and does not read `indexer/migrations/*.sql`. The linter only
checks the SQL files; wiring the runner to them is out of scope here.
