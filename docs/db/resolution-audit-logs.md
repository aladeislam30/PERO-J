# resolution_audit_logs (migration 0021)

Stores raw oracle responses. `db.createResolutionAuditLog()` in `indexer/src/db.js` already writes `submission_id`, `response_payload` (text), `response_status`, `response_headers`, `resolved_at`, `evidence_hash`; those columns exist. The issue's `market_id`, `adapter_name`, `raw_payload JSONB` (GIN indexed), `payload_sha256`, `fetched_at` are also present but nullable, since the existing code does not supply them. A CHECK requires at least one of `response_payload` / `raw_payload`.

- `market_id` is TEXT (matches `markets.id`), not BIGINT as in the issue.
- A trigger blocks UPDATE and DELETE (immutable evidence). TRUNCATE is not blocked.
- The migration file is not applied by `db.init()`; see `migrate-status.md`.
