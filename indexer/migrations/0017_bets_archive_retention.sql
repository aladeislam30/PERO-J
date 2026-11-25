-- Retention/archival for historical bets (#1163).
-- Bets of markets resolved more than N months ago move from `bets` to
-- `bets_archive` (same columns) in small batches. The `bets_all` view unions
-- both so old records stay queryable. Assumes `bets` has the key
-- (tx_hash, event_index) and `market_id`, as used by indexer/src/handlers/bet-placed.ts.
CREATE TABLE IF NOT EXISTS bets_archive (LIKE bets INCLUDING DEFAULTS);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_archive_tx_event
  ON bets_archive (tx_hash, event_index);
CREATE INDEX IF NOT EXISTS idx_bets_archive_market ON bets_archive (market_id);

CREATE OR REPLACE VIEW bets_all AS
  SELECT * FROM bets
  UNION ALL
  SELECT * FROM bets_archive;

-- Moves (or, with p_dry_run, only counts) up to p_batch eligible bets.
-- Eligible: market has an outcome and was last updated > p_months months ago.
-- Returns the number of rows moved / that would be moved. Call repeatedly
-- until it returns 0 (see indexer/scripts/archive-bets.js).
CREATE OR REPLACE FUNCTION archive_resolved_bets(
  p_months  INT     DEFAULT 12,
  p_batch   INT     DEFAULT 5000,
  p_dry_run BOOLEAN DEFAULT FALSE
) RETURNS BIGINT AS $$
DECLARE
  moved BIGINT;
BEGIN
  IF p_dry_run THEN
    SELECT COUNT(*) INTO moved FROM (
      SELECT 1 FROM bets b JOIN markets m ON m.id = b.market_id
       WHERE m.outcome IS NOT NULL
         AND m.updated_at < NOW() - make_interval(months => p_months)
       LIMIT p_batch
    ) s;
    RETURN moved;
  END IF;

  WITH victims AS (
    SELECT b.tx_hash, b.event_index
      FROM bets b JOIN markets m ON m.id = b.market_id
     WHERE m.outcome IS NOT NULL
       AND m.updated_at < NOW() - make_interval(months => p_months)
     LIMIT p_batch
  ), del AS (
    DELETE FROM bets b USING victims v
     WHERE b.tx_hash = v.tx_hash AND b.event_index = v.event_index
    RETURNING b.*
  ), ins AS (
    INSERT INTO bets_archive SELECT * FROM del
    ON CONFLICT (tx_hash, event_index) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO moved FROM del;
  RETURN moved;
END;
$$ LANGUAGE plpgsql;
