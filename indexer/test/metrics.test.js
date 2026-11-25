import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addCounter,
  observeHistogram,
  registerGauge,
  renderMetrics,
  resetMetrics,
} from "../src/metrics.js";

describe("Prometheus exposition (#1152)", () => {
  beforeEach(() => resetMetrics());

  it("renders cumulative histogram buckets, sum and count", () => {
    const labels = { method: "GET", route: "/x", status_code: 200 };
    observeHistogram("http_request_duration_seconds", "d", labels, 0.02, [0.01, 0.05]);
    observeHistogram("http_request_duration_seconds", "d", labels, 0.2, [0.01, 0.05]);
    const out = renderMetrics();
    assert.match(out, /# TYPE http_request_duration_seconds histogram/);
    assert.ok(out.includes('http_request_duration_seconds_bucket{method="GET",route="/x",status_code="200",le="0.01"} 0'));
    assert.ok(out.includes('le="0.05"} 1'));
    assert.ok(out.includes('le="+Inf"} 2'));
    assert.match(out, /http_request_duration_seconds_count\{[^}]*\} 2/);
  });

  it("renders counters and gauges", () => {
    addCounter("http_requests_total", "t", { status_code: 500 });
    addCounter("http_requests_total", "t", { status_code: 500 });
    registerGauge("db_pool_active_connections", "g", () => 3);
    const out = renderMetrics();
    assert.ok(out.includes('http_requests_total{status_code="500"} 2'));
    assert.match(out, /db_pool_active_connections 3/);
  });
});
