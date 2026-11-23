# Oracle adapters

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
