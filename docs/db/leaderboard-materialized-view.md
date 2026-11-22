# Leaderboard materialized view

Migration `indexer/migrations/0018_mv_leaderboard_ranks.sql` creates `mv_leaderboard_ranks` (bettor, bet_count, points, rank), a UNIQUE index on `bettor` (needed for `REFRESH ... CONCURRENTLY`), a rank index and `refresh_leaderboard()`.

## Refresh mechanism

Chosen: an explicit refresh function, run every 60 seconds either by `pg_cron` (`SELECT cron.schedule('leaderboard', '* * * * *', 'SELECT refresh_leaderboard()')`) or by `node indexer/scripts/refresh-leaderboard.js` (`--interval`, `--once`). Triggers were not used: a per-row trigger would force a full refresh on every bet insert, which defeats the optimisation.

## Not covered

- `points` is total net amount wagered, because the bets schema on main has no payout or win/loss columns. Update the view when they exist.
- The `GET /leaderboard` API (`db.getLeaderboard`) ranks contracts by event count, a different query, and was not changed to read this view. `db.refreshLeaderboard()` already exists in `indexer/src/db.js`.
- Nothing has been run, so the < 20ms target is unmeasured.
