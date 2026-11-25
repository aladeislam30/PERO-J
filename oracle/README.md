# Oracle

## Pluggable adapters

Every provider used by the daemon extends `BaseAdapter` (`src/adapters/base.js`)
and implements `resolve(params): Promise<boolean>`, throwing when no outcome can
be trusted. The base class supplies a per-adapter token bucket (each attempt,
retries included, spends a token), timeouts, and bounded exponential backoff for
network errors, HTTP 429 and 5xx. `Retry-After` is honoured up to `maxDelayMs`.

`AdapterRegistry` selects adapters by market slug (exact, or prefix such as
`crypto-*`) and falls back to the market category. All selected adapters must
agree. The daemon reads `slug` only from the `markets` row; rows without one use
their category. To add a provider:

```js
class MyAdapter extends BaseAdapter {
  constructor(options) {
    super({ name: "mine", rateLimit: { capacity: 5, refillPerSecond: 1 }, ...options });
  }
  async resolve(params) {
    const data = await this.getJson("https://provider.example/price");
    return priceOutcome(parsePrice(data?.price, this.name), params);
  }
}
registry.register(new MyAdapter()).routeSlug("mine-*", ["mine"]);
```

Keys: `COINMARKETCAP_API_KEY`, `ODDSAPI_API_KEY`, `NOAA_API_TOKEN`, and
`POLITICS_FEED_URL` / `POLITICS_FEED_API_KEY` (politics is registered only when
its feed URL is set). Limits are per process; replicas sharing a key must divide
the quota between them.

## Auto-finalization

Every `ORACLE_FINALIZE_POLL_MS` (default 60 s; keep below 5 minutes) the daemon
calls `finalize_outcome` for undisputed submissions past their deadline, using
`ORACLE_HOT_WALLET_SECRET`. The contract resolves the market and returns the
bond to the submitter. `ORACLE_CHALLENGE_WINDOW_SECONDS` (default 259200) must
match the deployed contract; calling early is rejected on-chain and retried.

The deployed contract must expose `finalize_outcome(market_id)`. The market
contract in `contracts/market` does not yet, so until it does calls fail, are
logged, and leave the market `submitted`.

## Source factories

Dependency-free Node.js 20+ adapters for resolving political, weather, and
launch outcomes. Each adapter accepts an injectable `fetchImpl` for integration
with an existing oracle runtime. A resolution is returned as either
`{ status: "pending", reason }` or `{ status: "resolved", outcome, evidence }`.
Source/network errors are thrown so callers can report failures instead of
mistaking them for unresolved or successful outcomes.

## Politics

`createPoliticsAdapter({ endpoint, apiKey, fetchImpl })` fetches an election
feed, adding `electionId` as a query parameter and an optional bearer token.
The feed must return an election object (or an `election` object) with `status`
and `races`. Race entries identify a race using `id` or `raceId`, and report
the winner using `winnerId`, `winnerCandidateId`, or a candidate with
`winner: true`. Only `certified`, `final`, or `official` results resolve.
Call `resolve({ electionId, raceId, candidateId })` to test whether that
candidate won.

## Weather and launches

`createScienceWeatherAdapter({ noaaEndpoint, noaaToken, launchEndpoint,
fetchImpl })` uses NOAA's daily GHCND data endpoint by default and SpaceX's
launch-by-ID endpoint by default.

- `resolveWeather({ stationId, date, metric, operator, threshold, unit })` supports
  NOAA `TMAX`, `TMIN` (values normalized from tenths of °C), and `PRCP`
  (tenths of mm), with `gt`, `gte`, `lt`, `lte`, and `eq` comparisons.
  Threshold units must be `C`/`°C` for temperatures and `mm` for precipitation.
  Provide a NOAA token when required by the configured endpoint.
- `resolveLaunch({ launchId, outcome })` supports `success`, `failure`,
  `scrubbed`, and `cancelled`. A SpaceX `success` boolean resolves to
  `success` or `failure`; scrubbed/cancelled outcomes resolve only when the
  configured source explicitly reports that status. Upcoming or incomplete
  launches remain pending.

Sample election, NOAA, and launch payloads are in `test/fixtures/`.

## Daemon

`npm start` runs the auto-submitter daemon. The daemon uses TypeScript modules,
so start it through `npm start` (tsx) rather than `node src/daemon.js` on Node 20.
`npm run typecheck` and `npm test` verify the package.

### Council inactivity monitor

Every hour the daemon reads `get_active_disputes` from the oracle contract and
counts distinct votes from current council members. A dispute without quorum
pages the council at 24h, 48h (`warning`) and 60h (`critical`) of its 72-hour
voting period. Incidents resolve when quorum is reached or the dispute closes,
and failed notifications are retried on the next check.

| Variable | Purpose |
| --- | --- |
| `ORACLE_CONTRACT_ID` | Oracle contract holding the disputes (required) |
| `PAGERDUTY_ROUTING_KEY` | Events API v2 key of a service that escalates to the council (required) |
| `ORACLE_COUNCIL_ROSTER` | Comma-separated council addresses (required) |
| `ORACLE_COUNCIL_QUORUM` | Votes required; defaults to a strict majority |

Notification state is kept in memory. After a restart the current milestone is
re-sent under the same deduplication key; an incident whose dispute closed while
the daemon was down must be resolved manually.

### Bond escrow audit

Every 30 seconds the daemon compares `dispute_bonds` with the escrow contract's
balance on the native XLM SAC and asserts, in whole stroops:

```
total_bonds_deposited - total_bonds_settled == current_escrow_holdings
```

It also checks each bond: `settled_amount` is the amount that left escrow
(returned or slashed) and must equal `amount` once the bond is settled.

A violation immediately trips a circuit breaker and sends a critical PagerDuty
alert. While tripped, no outcome is submitted. The breaker is stored in
`circuit_breakers`, survives restarts, and must be reset by an operator.
Resolution is also blocked until the first audit passes, when three audit
intervals go by without a pass, or when the breaker cannot be read.

| Variable | Purpose |
| --- | --- |
| `BOND_ESCROW_CONTRACT_ID` | Contract holding bonds; unset disables the audit and its gate |
| `BOND_AUDIT_INTERVAL_MS` | Audit interval, default `30000` |
| `PAGERDUTY_OPS_ROUTING_KEY` | Alert key; falls back to `PAGERDUTY_ROUTING_KEY` |

The escrow contract must hold bonds only: pools, fees or unrelated XLM there
count as a mismatch. Bond records must also be written promptly, because a
deposit or settlement missing from the database trips the breaker.

`npm run audit:bonds` runs one audit and exits non-zero on a violation.
`npm run audit:bonds -- --reset` clears the breaker if the audit passes.
The tables are created by the indexer migrations (`npm run migrate` in `indexer/`).
