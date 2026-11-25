# X-Request-ID tracing

`indexer/src/requestContext.js` provides `requestIdMiddleware`, mounted first in `createApp()`.

- Reads an inbound `X-Request-ID` (accepted: 1-128 chars of `A-Za-z0-9._:-`), otherwise generates a UUID.
- Echoes it as the `X-Request-ID` response header and stores it in `AsyncLocalStorage` (`getRequestId()`).
- Logs: `console.*` output inside a request is prefixed with `[request_id=<id>]` (there is no Winston/Pino logger in the indexer).
- Database: `db.query()` prefixes SQL with `/* request_id=<id> */` so it shows in `pg_stat_activity` and slow-query logs.

Not covered: queries issued by `db` methods that call `pool.query` directly (only `db.query()` is tagged),
and background workers, which have no request context.
