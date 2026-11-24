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
