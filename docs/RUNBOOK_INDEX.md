# Runbook Index

This index maps every active operational alert to the runbook that contains its
step-by-step recovery procedure. On-call engineers should open the linked
runbook as soon as an alert fires.

| Alert | Runbook |
| --- | --- |
| `IndexerStalled` | [INDEXER_RUNBOOK.md](./INDEXER_RUNBOOK.md) |
| `MarketStuck` | [ORACLE_RUNBOOK.md](./ORACLE_RUNBOOK.md) |
| `LeaderboardDrift` | [LEADERBOARD_REBUILD_RUNBOOK.md](./LEADERBOARD_REBUILD_RUNBOOK.md) |
| `RPCHighErrorRate` | [ORACLE_ADAPTER_FRESHNESS.md](./ORACLE_ADAPTER_FRESHNESS.md) |

## Verification Commands

Use these commands to confirm the alert state and the health of the affected
component before and after remediation.

```bash
# Confirm which alerts are currently firing
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {name: .labels.alertname, state: .state}'

# IndexerStalled: check indexer progress
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=indexer_last_processed_ledger' | jq '.data.result'

# MarketStuck: check oracle price freshness
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=time() - oracle_last_update_timestamp_seconds' | jq '.data.result'

# LeaderboardDrift: compare leaderboard vs source of truth
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=leaderboard_drift_score' | jq '.data.result'

# RPCHighErrorRate: check RPC adapter error ratio
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=rate(rpc_adapter_errors_total[5m]) / rate(rpc_adapter_requests_total[5m])' | jq '.data.result'
```

## Remediation CLI Scripts

Each runbook documents its own remediation steps. The commands below are the
entry points referenced by those runbooks.

```bash
# IndexerStalled -> INDEXER_RUNBOOK.md
./scripts/indexer/restart-indexer.sh

# MarketStuck -> ORACLE_RUNBOOK.md
./scripts/oracle/refresh-oracle-feed.sh

# LeaderboardDrift -> LEADERBOARD_REBUILD_RUNBOOK.md
./scripts/leaderboard/rebuild-leaderboard.sh

# RPCHighErrorRate -> ORACLE_ADAPTER_FRESHNESS.md
./scripts/oracle/check-adapter-freshness.sh
```

## Maintenance

When a new alert is added to the Prometheus rules, add a row to the table above
and link it to a tested runbook. Every active alert must link directly to a
runbook before it is enabled in production.
