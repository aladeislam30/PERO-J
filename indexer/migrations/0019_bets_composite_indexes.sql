-- Composite indexes for bets lookups (market + bettor, recent-first scans).
-- NOTE: the bets table is not created anywhere in code on main (db.js only
-- queries it, using created_at and id). The indexes are guarded so this
-- migration is a no-op where bets does not exist yet. Columns assumed:
-- market_id, bettor, created_at.
-- CONCURRENTLY is not used: migrations may run inside a transaction.
DO $$
BEGIN
  IF to_regclass('public.bets') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bets_market_bettor ON bets (market_id, bettor)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bets_created_at_desc ON bets (created_at DESC)';
  END IF;
END
$$;
