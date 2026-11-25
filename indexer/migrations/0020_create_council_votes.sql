-- Individual council votes on disputed markets (on-chain and off-chain deliberation).
-- markets.id is TEXT in this schema, so market_id is TEXT (the issue's BIGINT would
-- not match the FK target). voter_address is a 56-char Stellar address.
-- outcome: TRUE = uphold the proposed outcome, FALSE = overturn.
-- source: 'on_chain' votes carry a tx_hash; 'off_chain' deliberation votes may not.
CREATE TABLE IF NOT EXISTS council_votes (
  id            SERIAL PRIMARY KEY,
  market_id     TEXT NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  voter_address VARCHAR(56) NOT NULL,
  outcome       BOOLEAN NOT NULL,
  source        TEXT NOT NULL DEFAULT 'on_chain' CHECK (source IN ('on_chain', 'off_chain')),
  voted_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  tx_hash       VARCHAR(64),
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT council_votes_market_voter_key UNIQUE (market_id, voter_address),
  CONSTRAINT council_votes_on_chain_tx_hash CHECK (source <> 'on_chain' OR tx_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_council_votes_market ON council_votes (market_id);
CREATE INDEX IF NOT EXISTS idx_council_votes_voter ON council_votes (voter_address);
