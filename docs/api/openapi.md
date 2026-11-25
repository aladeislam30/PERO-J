# OpenAPI documentation

`indexer/src/openapi.js` holds a route table (`ROUTES`) and builds an OpenAPI 3.0.3 document, served by
`registerOpenApi(app)` from `indexer/src/api.js`:

- `GET /api/v1/openapi.json` - machine-readable spec
- `GET /api/v1/docs` - minimal static HTML listing (no external assets, so it works under the strict CSP)

`indexer/test/openapi.test.js` scans `api.js` for `app.<verb>("...")` / `v1Router.<verb>("...")` registrations
and fails if one is missing from the spec, so new routes must be added to `ROUTES`.

Not covered: request/response schemas are generic (`object`); the legacy `src/server.js` swagger-jsdoc setup
(`/docs`) is untouched, and `swagger-jsdoc` is not a declared dependency, so annotations were not used.
