# Per-route rate limits

Implemented in `indexer/src/routeRateLimit.js` and mounted on `/api` in `indexer/src/api.js`.
Fixed one-minute window, counted per client IP and per bucket.

| Bucket | Routes (relative to `/api/v1`) | Limit / min |
| --- | --- | --- |
| `oracle-write` | `POST /oracle/*`, `POST /disputes/bonds*` | 10 |
| `bettor` | `/bets`, `/wallet*`, `/profile*`, `/leaderboard` | 60 |
| `market-read` | `GET /markets*` | 120 |
| `default` | any other `/api` route | 100 |

Every response carries `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and the
`X-RateLimit-*` equivalents. Exceeding a limit returns `429` with `Retry-After` (seconds).
`/health`, `/ready` and `/metrics` are outside `/api` and unaffected.

Notes: the store is in-memory (per process). The issue suggests a Redis-backed `express-rate-limit`
store; no Redis store dependency is installed, so that is not included. Limits for the `bettor` and
`oracle-write` buckets are assumptions derived from the issue's examples.
