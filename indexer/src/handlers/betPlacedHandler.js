'use strict';

async function handleBetPlacedEvent(event, db) {
  const { marketId, user, amount, outcome, timestamp } = event.data;
  await db.query(
    `INSERT INTO bets (market_id, user_address, amount, outcome, created_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5))
     ON CONFLICT (market_id, user_address, outcome) DO UPDATE
     SET amount = bets.amount + EXCLUDED.amount`,
    [marketId, user, amount, outcome, timestamp]
  );
}

module.exports = { handleBetPlacedEvent };
