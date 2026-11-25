# Runbook: RPC Adapter Health & High Error Rate (`RPCHighErrorRate`)

## Overview
- **Alert Name**: `RPCHighErrorRate`
- **Severity**: `High`
- **Condition**: `rate(rpc_errors_total[5m]) > 0.05`
- **Service**: `rpc-adapter`
- **Escalation**: Infrastructure & Stellar Node Operators

## Symptoms
- Elevated rate of RPC failures (HTTP 429 rate limit exceeded, 502/503 bad gateway, or socket timeout errors) when communicating with the Stellar Horizon / Soroban RPC endpoint.
- Delayed event ingestion and degraded API response times.

## Verification Commands

1. **Check Live RPC Endpoint Status**:
   ```bash
   curl -s -w "\nHTTP Status: %{http_code}\nTime Total: %{time_total}s\n" \
     -X POST "${RPC_URL:-https://soroban-testnet.stellar.org}" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

2. **Inspect Error Rate Metric in Prometheus**:
   ```promql
   sum(rate(rpc_errors_total[5m])) by (method, error_code)
   ```

3. **Check Indexer RPC Request Logs**:
   ```bash
   docker logs --tail 200 peroj-indexer-1 | grep -i "rpc.*error\|soroban.*fail"
   ```

## Remediation Procedure

1. **Failover to Alternate RPC Endpoint**:
   Switch the active RPC provider immediately using the remediation script:
   ```bash
   ./scripts/remediation/switch_rpc_provider.sh https://soroban-rpc.backup.provider.com
   ```

2. **Handle Rate Limiting (HTTP 429)**:
   - Check if the API key for the current RPC node provider has hit rate tiers or quotas.
   - Adjust request backoff and poll interval:
     Increase `INDEXER_POLL_INTERVAL_MS` from default (e.g., 5000ms to 10000ms) during degraded network periods.

3. **Verify Error Rate Stabilization**:
   Monitor the error rate in Prometheus expression browser:
   ```promql
   rate(rpc_errors_total[5m]) < 0.01
   ```
   Ensure the alert clears and transitions to resolved.

## Oracle Signed Payload Replay Defenses (Issue #1210)

Off-chain oracle outcome attestations are signed off-chain and submitted via API. To prevent a signed message from an earlier market being replayed on a subsequent market, the following defenses are enforced.

### Signed Payload Structure

Every oracle attestation MUST be signed over a domain-separated payload that binds the signature to a specific chain, market, and single-use nonce:

```json
{
  "domain_separator": "peroj-oracle-attestation-v1",
  "chain_id": "<stellar network passphrase / chain id>",
  "market_id": "<market identifier>",
  "nonce": "<unique, single-use value>",
  "timestamp": "<unix seconds>",
  "outcome": "<attested outcome>"
}
```

- `domain_separator` prevents cross-protocol signature reuse.
- `chain_id` prevents cross-network replay (testnet vs mainnet).
- `market_id` prevents replaying an attestation on a different market.
- `nonce` guarantees each signed message is consumed at most once.

### Nonce Consumption Table

Consumed nonces are persisted with a unique constraint on `(provider_id, nonce)`. On submission the API inserts the nonce; a unique-constraint violation means the message was already consumed and the request is rejected immediately.

```sql
CREATE TABLE oracle_consumed_nonces (
  provider_id TEXT NOT NULL,
  nonce       TEXT NOT NULL,
  market_id   TEXT NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_provider_nonce UNIQUE (provider_id, nonce)
);
```

### Freshness Window

Signatures whose `timestamp` is older than **5 minutes** are rejected before any state is mutated. Combined with the nonce table, this rejects both stale and replayed attestations.

### Verification

1. **Confirm replay rejection** — resubmit an identical signed payload and expect an immediate rejection:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "${API_URL}/oracle/attestation" \
     -H "Content-Type: application/json" \
     --data @replay_payload.json
   # First submission: 200/201. Identical replay: 409 (nonce already consumed).
   ```

2. **Confirm stale rejection** — submit a payload with `timestamp` older than 5 minutes and expect `401`/`422`.

3. **Inspect consumed nonces**:
   ```sql
   SELECT provider_id, nonce, market_id, consumed_at
   FROM oracle_consumed_nonces
   ORDER BY consumed_at DESC
   LIMIT 20;
   ```
