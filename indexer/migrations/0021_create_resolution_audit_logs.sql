-- Raw oracle responses kept as audit evidence.
-- indexer/src/db.js createResolutionAuditLog() already inserts into this table
-- using (submission_id, response_payload, response_status, response_headers,
-- resolved_at, evidence_hash) with ON CONFLICT (submission_id), and reads
-- recorded_at. Those columns are kept for compatibility. The adapter-style
-- columns from the issue (market_id, adapter_name, raw_payload JSONB,
-- payload_sha256, fetched_at) are added as nullable so either writer works.
-- markets.id is TEXT here, so market_id is TEXT.
CREATE TABLE IF NOT EXISTS resolution_audit_logs (
  id               SERIAL PRIMARY KEY,
  submission_id    BIGINT UNIQUE REFERENCES oracle_submissions(id) ON DELETE RESTRICT,
  response_payload TEXT,
  response_status  INTEGER,
  response_headers JSONB,
  resolved_at      TIMESTAMP WITH TIME ZONE,
  evidence_hash    VARCHAR(64),
  market_id        TEXT REFERENCES markets(id) ON DELETE RESTRICT,
  adapter_name     VARCHAR(64),
  raw_payload      JSONB,
  payload_sha256   VARCHAR(64),
  fetched_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  recorded_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT resolution_audit_logs_has_payload
    CHECK (response_payload IS NOT NULL OR raw_payload IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_resolution_audit_logs_market ON resolution_audit_logs (market_id);
CREATE INDEX IF NOT EXISTS idx_resolution_audit_logs_raw_payload_gin
  ON resolution_audit_logs USING GIN (raw_payload);

-- Immutability: audit rows cannot be updated or deleted.
CREATE OR REPLACE FUNCTION resolution_audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'resolution_audit_logs rows are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolution_audit_logs_immutable ON resolution_audit_logs; -- lint:allow-destructive
CREATE TRIGGER trg_resolution_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON resolution_audit_logs
  FOR EACH ROW EXECUTE FUNCTION resolution_audit_logs_immutable();
