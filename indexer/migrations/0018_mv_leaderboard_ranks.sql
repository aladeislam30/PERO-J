-- Leaderboard materialized view (#1164).
-- No win/loss or payout columns exist in the bets schema used by
-- indexer/src/handlers/bet-placed.ts, so points = total net amount wagered.
-- Extend the SELECT when payout data is available.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_leaderboard_ranks AS
  SELECT bettor,
         COUNT(*)                                  AS bet_count,
         COALESCE(SUM(net_amount), 0)              AS points,
         RANK() OVER (ORDER BY COALESCE(SUM(net_amount), 0) DESC) AS rank
    FROM bets
   GROUP BY bettor;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_leaderboard_ranks_bettor
  ON mv_leaderboard_ranks (bettor);
CREATE INDEX IF NOT EXISTS idx_mv_leaderboard_ranks_rank
  ON mv_leaderboard_ranks (rank, bettor);

-- Refresh without blocking readers. Call from a scheduler:
--   pg_cron:  SELECT cron.schedule('leaderboard', '* * * * *', 'SELECT refresh_leaderboard()');
--   or indexer/scripts/refresh-leaderboard.js (loops every 60s).
CREATE OR REPLACE FUNCTION refresh_leaderboard() RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard_ranks;
END;
$$ LANGUAGE plpgsql;
