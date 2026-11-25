# Prometheus metrics

`GET /metrics` (served by `indexer/src/api.js`) returns the text exposition format produced by
`indexer/src/metrics.js` (hand-written; `prom-client` is not a dependency).

| Metric | Type | Labels |
| --- | --- | --- |
| `http_requests_total` | counter | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | histogram (5ms..10s) | `method`, `route`, `status_code` |
| `db_query_duration_seconds` | histogram | none (only `db.query()` is timed) |
| `db_pool_active_connections` | gauge | none (from `db.getPoolMetrics()` when available) |
| `indexer_unmapped_events_total` | counter | pre-existing |

Set `METRICS_TOKEN` to require `Authorization: Bearer <token>` on `/metrics` (unset = open).
`route` is the matched Express route pattern, or `unmatched`, to keep cardinality bounded.

Example scrape config (not added to `infra/monitoring/prometheus.yml`):

```yaml
scrape_configs:
  - job_name: pero-indexer-api
    metrics_path: /metrics
    authorization: { credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["indexer:3001"] }]
```

Percentiles: `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))`.
