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


| Prometheus Alert Name | Target Service | Severity | Markdown Runbook | Verification Command | Remediation Script |
|---|---|---|---|---|---|
| **`IndexerStalled`** | `indexer` | `Critical` | [INDEXER_RUNBOOK.md](INDEXER_RUNBOOK.md) | `curl -s http://localhost:3001/api/health` | [`scripts/remediation/restart_indexer.sh`](../scripts/remediation/restart_indexer.sh) |
| **`MarketStuck`** / `MarketStuckInUnresolved` | `oracle` | `Critical` | [ORACLE_RUNBOOK.md](ORACLE_RUNBOOK.md) | `curl -s http://localhost:3001/api/markets?status=open&expired=true` | [`scripts/remediation/resolve_stuck_market.sh`](../scripts/remediation/resolve_stuck_market.sh) |
| **`LeaderboardDrift`** | `indexer` / `db` | `High` | [LEADERBOARD_REBUILD_RUNBOOK.md](LEADERBOARD_REBUILD_RUNBOOK.md) | `curl -s http://localhost:3001/api/leaderboard/status` | [`scripts/remediation/rebuild_leaderboard.sh`](../scripts/remediation/rebuild_leaderboard.sh) |
| **`RPCHighErrorRate`** | `rpc-adapter` | `High` | [ORACLE_ADAPTER_FRESHNESS.md](ORACLE_ADAPTER_FRESHNESS.md) | `curl -s -X POST $RPC_URL -d '{"method":"getHealth"}'` | [`scripts/remediation/switch_rpc_provider.sh`](../scripts/remediation/switch_rpc_provider.sh) |
| **`CouncilVoteStalled`** | `governance` | `High` | [COUNCIL_RUNBOOK.md](COUNCIL_RUNBOOK.md) | `curl -s http://localhost:3001/api/disputes?status=escalated` | N/A (Governance Quorum Notification) |
| **`BackupFailed`** / `PITRRestoreTestFailed` | `db` / `backup` | `Critical` | [backup.md](backup.md) | `./scripts/backup-restore-test.sh` | [`scripts/backup.sh`](../scripts/backup.sh) |


```bash
# Confirm which alerts are currently firing
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {name: .labels.alertname, state: .state}'

# IndexerStalled: check indexer progress
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=indexer_last_processed_ledger' | jq '.data.result'

