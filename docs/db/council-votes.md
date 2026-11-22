# council_votes (migration 0020)

One row per council member per disputed market (`UNIQUE (market_id, voter_address)`).

- `market_id` is `TEXT` with `ON DELETE RESTRICT` to `markets(id)` (that table's id is TEXT, not BIGINT as the issue says).
- `outcome`: `TRUE` uphold, `FALSE` overturn. Abstentions (see `frontend/src/api.ts` `CouncilVote`) are not representable; do not insert them.
- `source`: `on_chain` (requires `tx_hash`) or `off_chain` (deliberation, `tx_hash` optional).

Nothing in the indexer writes to or reads this table yet. Like the other `indexer/migrations/*.sql` files, it is not applied by `db.init()` (see `migrate-status.md`).
