import { addCounter, observeHistogram, registerGauge } from "../metrics.js";
import { db } from "../db.js";

registerGauge("db_pool_active_connections", "Active (checked-out) DB pool connections", () => {
  const m = typeof db.getPoolMetrics === "function" ? db.getPoolMetrics() : null;
  if (!m) return NaN;
  return m.active ?? m.total - m.idle ?? NaN;
});

/** Low-cardinality route label: matched route pattern, else a bounded fallback. */
function routeLabel(req) {
  if (req.route?.path) return `${req.baseUrl || ""}${req.route.path}`;
  return "unmatched";
}

/**
 * Records http_requests_total and http_request_duration_seconds, and guards
 * GET /metrics with `Authorization: Bearer $METRICS_TOKEN` when that env var is set.
 */
export function httpMetricsMiddleware(req, res, next) {
  if (req.path === "/metrics") {
    const token = process.env.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  }
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method: req.method, route: routeLabel(req), status_code: res.statusCode };
    addCounter("http_requests_total", "Total HTTP requests", labels);
    observeHistogram(
      "http_request_duration_seconds",
      "HTTP request duration in seconds",
      labels,
      seconds,
    );
  });
  next();
}
