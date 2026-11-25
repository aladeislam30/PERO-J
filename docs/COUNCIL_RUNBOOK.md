# Council Runbook

Operational guidance for the Council (dispute resolution) pipeline and the
alerting that guards it. This runbook covers the two monitoring rules that
protect user funds from a stalled oracle pipeline:

- `MarketStuckInUnresolved` — markets left open more than 48h past expiry.
- `CouncilVoteStalled` — escalated disputes that have not gathered enough
  council votes within 24h.

Both rules are defined in `infra/monitoring/prometheus.yml` and routed through
`infra/monitoring/alertmanager.yml` to the operations team.

## Alert: MarketStuckInUnresolved

**Expression**

```
count(markets{status="open", ends_at_elapsed_hours > 48}) > 0
```

**Meaning**

One or more markets have been past their `ends_at` timestamp for more than 48
hours without an outcome being submitted or the market being finalized. This
indicates a failure in the oracle pipeline and leaves user funds frozen.

**Severity / routing**

- Severity: `critical` (pages the on-call operator).
- Routed to the operations team via Alertmanager.
- The alert annotation includes the affected market IDs so the responder can
  jump straight to the stuck markets.

**Response**

1. Read the affected market IDs from the alert annotation.
2. For each market, check whether an outcome was submitted but not finalized,
   or whether no outcome was submitted at all.
3. If an outcome exists, finalize the market.
4. If no outcome exists, escalate to the oracle operators to submit the outcome,
   then finalize.
5. Confirm the alert resolves once all listed markets are no longer `open` past
   the 48h threshold.

## Alert: CouncilVoteStalled

**Expression**

```
count(disputes{status="escalated", elapsed_hours > 24, votes_cast < 4}) > 0
```

**Meaning**

One or more disputes have been escalated to the Council for more than 24 hours
but have fewer than 4 votes cast. Council inactivity stalls resolution and keeps
funds locked.

**Severity / routing**

- Severity: `critical` (pages the on-call operator).
- Routed to the operations team via Alertmanager.
- The alert annotation includes the affected dispute IDs.

**Response**

1. Read the affected dispute IDs from the alert annotation.
2. Contact the council members who have not yet voted and request votes.
3. If quorum cannot be reached, follow the council escalation policy to
   reassign or resolve the dispute.
4. Confirm the alert resolves once each listed dispute has at least 4 votes or
   is no longer `escalated`.

## Paging

Both rules dispatch paging notifications to the designated operators through
Alertmanager. Verify the receiver configuration in
`infra/monitoring/alertmanager.yml` points at the operations on-call rotation
before relying on these alerts in production.
2. **Emergency Fallback (if quorum unreachable)**:
   - If council members are offline past 48 hours, follow protocol charter Article IV (Emergency Governor fallback vote or protocol multisig resolution).

## Related Runbook: Contract Upgrade Playbook

For the full step-by-step procedure to upgrade live Soroban contracts (build optimized WASM, compute SHA-256 hash, deploy to Testnet, run migration tests, verify byte-for-byte hash identity, execute the multi-sig admin upgrade on Mainnet, verify event indexing resumes, and roll back or abort on failure), see [`docs/CONTRACT_UPGRADE_PLAYBOOK.md`](./CONTRACT_UPGRADE_PLAYBOOK.md).
