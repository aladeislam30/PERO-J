/**
 * OpenAPI 3.0 document for the indexer API (issue #1150).
 *
 * Every route registered in api.js must be listed in ROUTES below;
 * test/openapi.test.js scans api.js and fails if a registered route is missing.
 * Paths are the literal registered paths (`/api/v1/...` for v1Router routes).
 */
const ID = { name: "id", in: "path", required: true, schema: { type: "string" } };
const SEQ = { name: "seq", in: "path", required: true, schema: { type: "integer" } };
const LIMIT = { name: "limit", in: "query", schema: { type: "integer" } };
const OFFSET = { name: "offset", in: "query", schema: { type: "integer" } };

/** [method, path, summary, tag, { params, body, admin }] */
export const ROUTES = [
  ["get", "/metrics", "Prometheus metrics (optional bearer METRICS_TOKEN)", "Ops"],
  ["get", "/health", "Liveness and indexer lag", "Ops"],
  ["get", "/ready", "Readiness probe", "Ops"],
  ["get", "/api/v1/functions", "Distinct function names across events", "Events"],
  ["get", "/api/v1/oracle/disputes", "List oracle disputes", "Oracle", { params: [LIMIT, OFFSET] }],
  ["post", "/api/v1/oracle/resolutions/{submissionId}/evidence", "Submit resolution evidence", "Oracle", {
    params: [{ name: "submissionId", in: "path", required: true, schema: { type: "string" } }],
    body: true,
    admin: true,
  }],
  ["get", "/api/v1/oracle/resolutions/{submissionId}/evidence", "Get resolution evidence", "Oracle", {
    params: [{ name: "submissionId", in: "path", required: true, schema: { type: "string" } }],
  }],
  ["get", "/api/tokens/{id}/metadata", "SEP-41 token metadata", "Tokens", { params: [ID] }],
  ["get", "/api/v1/leaderboard", "Leaderboard", "Bettors", { params: [LIMIT] }],
  ["get", "/api/v1/markets", "List markets", "Markets", { params: [LIMIT, OFFSET] }],
  ["get", "/api/v1/markets/{id}", "Get market", "Markets", { params: [ID] }],
  ["get", "/api/v1/markets/{id}/odds", "Market odds", "Markets", { params: [ID] }],
  ["post", "/api/v1/events/bet-placed", "Record a bet-placed event", "Events", { body: true }],
  ["get", "/api/v1/oracle/circuit-breaker", "Oracle circuit breaker status", "Oracle"],
  ["post", "/api/v1/oracle/audit-bonds", "Audit oracle bonds", "Oracle", { body: true, admin: true }],
  ["get", "/api/v1/disputes/bonds", "List dispute bonds", "Disputes"],
  ["post", "/api/v1/disputes/bonds", "Create dispute bond", "Disputes", { body: true }],
  ["post", "/api/v1/disputes/bonds/{id}/settle", "Settle dispute bond", "Disputes", { params: [ID], body: true, admin: true }],
  ["get", "/api/v1/bets", "Bettor history", "Bettors", { params: [LIMIT, OFFSET] }],
  ["get", "/api/v1/events", "List events", "Events", { params: [LIMIT, OFFSET] }],
  ["get", "/api/v1/events/stream", "Server-sent events stream", "Events"],
  ["get", "/api/markets/stream", "Market updates stream (legacy path)", "Markets"],
  ["get", "/api/events/{seq}/raw", "Raw event by sequence (legacy path)", "Events", { params: [SEQ] }],
  ["get", "/api/v1/events/{seq}", "Get event by sequence", "Events", { params: [SEQ] }],
  ["get", "/api/v1/contracts", "List registered contracts", "Contracts"],
  ["get", "/api/v1/contracts/{id}/events", "Events for a contract", "Contracts", { params: [ID, LIMIT, OFFSET] }],
  ["get", "/api/v1/contracts/{id}", "Get contract metadata", "Contracts", { params: [ID] }],
  ["post", "/api/v1/contracts", "Register contract ABI metadata", "Contracts", { body: true }],
  ["post", "/api/oracle/attestations", "Submit oracle attestation", "Oracle", { body: true }],
  ["post", "/api/oracle/attestation", "Submit oracle attestation (alias)", "Oracle", { body: true }],
];

export function buildOpenApiDocument() {
  const paths = {};
  for (const [method, path, summary, tag, o = {}] of ROUTES) {
    const op = {
      summary,
      tags: [tag],
      responses: {
        200: { description: "Success" },
        429: { description: "Rate limit exceeded (see Retry-After)" },
      },
    };
    if (o.params) op.parameters = o.params;
    if (o.body) {
      op.requestBody = { required: true, content: { "application/json": { schema: { type: "object" } } } };
      op.responses[400] = { description: "Invalid request" };
    }
    if (o.admin) {
      op.security = [{ bearerAuth: [] }];
      op.responses[401] = { description: "Unauthorized" };
    }
    (paths[path] ??= {})[method] = op;
  }
  return {
    openapi: "3.0.3",
    info: { title: "PERO-J Indexer API", version: "1.0.0" },
    paths,
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderDocsHtml(doc) {
  const rows = Object.entries(doc.paths)
    .flatMap(([p, ops]) =>
      Object.entries(ops).map(
        ([m, op]) => `<tr><td>${m.toUpperCase()}</td><td><code>${esc(p)}</code></td><td>${esc(op.summary)}</td></tr>`,
      ),
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.info.title)}</title></head><body><h1>${esc(
    doc.info.title,
  )}</h1><p><a href="/api/v1/openapi.json">openapi.json</a></p><table border="1" cellpadding="4"><tr><th>Method</th><th>Path</th><th>Summary</th></tr>${rows}</table></body></html>`;
}

/** Serves /api/v1/openapi.json and a dependency-free /api/v1/docs page. */
export function registerOpenApi(app) {
  const doc = buildOpenApiDocument();
  app.get("/api/v1/openapi.json", (_req, res) => res.json(doc));
  app.get("/api/v1/docs", (_req, res) => res.type("html").send(renderDocsHtml(doc)));
}
