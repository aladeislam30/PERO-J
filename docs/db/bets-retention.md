# Bets retention and archival

Policy: bets of active markets stay in `bets`. Bets of markets that have an outcome and were last updated more than 12 months ago move to `bets_archive`.

- Migration `indexer/migrations/0017_bets_archive_retention.sql` creates `bets_archive`, the `bets_all` view (union of both) and `archive_resolved_bets(months, batch, dry_run)`.
- Script `indexer/scripts/archive-bets.js` calls the function batch by batch, each batch in its own transaction.

```
cd indexer
DATABASE_URL=... node scripts/archive-bets.js --dry-run
DATABASE_URL=... node scripts/archive-bets.js --months 12 --batch-size 5000
```

Run it from cron or a Kubernetes CronJob (e.g. weekly). Query historical data through `bets_all`.

## Not covered

- Declarative partitioning of `bets` by year/quarter: converting an existing table in place needs a data migration and a repository-wide `bets` DDL, which is not on main (no `CREATE TABLE bets` exists there). An archive table was used instead.
- Export to S3/cold storage: not implemented. Dump `bets_archive` with `pg_dump -t bets_archive` or `COPY` to ship it.
- "Resolved" is approximated by `markets.outcome IS NOT NULL` and `markets.updated_at`; adjust if a dedicated resolved timestamp is added.
