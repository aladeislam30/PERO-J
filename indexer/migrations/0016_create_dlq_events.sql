-- Dead-letter queue for ledger events that could not be processed.
-- Columns match the writers/readers in indexer/src/db.js (insertDlqEvent,
-- retryDlqEvent) and indexer/src/dlq-worker.js (resolved, error, stack,
-- next_retry_at).
CREATE TABLE IF NOT EXISTS dlq_events (
  id              SERIAL PRIMARY KEY,
  ledger_sequence BIGINT,
  tx_hash         VARCHAR(64),
  topic           VARCHAR(128),
  payload         JSONB,
  error_message   TEXT,
  retry_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- retry-worker bookkeeping
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  error           TEXT,
  stack           TEXT,
  next_retry_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dlq_events_retry_created
  ON dlq_events (retry_count, created_at);
