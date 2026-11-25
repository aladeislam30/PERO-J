/** Minimal Prometheus counter registry (text exposition format). */
const counters = new Map();

export function incCounter(name, help, labels = {}) {
  const c = counters.get(name) ?? { help, values: new Map() };
  const key = Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/(["\\])/g, '\\$1')}"`)
    .join(',');
  c.values.set(key, (c.values.get(key) ?? 0) + 1);
  counters.set(name, c);
}

export function renderMetrics() {
  let out = '';
  for (const [name, { help, values }] of counters) {
    out += `# HELP ${name} ${help}\n# TYPE ${name} counter\n`;
    for (const [labels, v] of values)
      out += `${name}${labels ? `{${labels}}` : ''} ${v}\n`;
  }
  out += renderHistogramsAndGauges();
  return out;
}

export function resetMetrics() {
  counters.clear();
  histograms.clear();
  gauges.clear();
}

// ---- Histograms and gauges (issue #1152) ----
export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const histograms = new Map();
const gauges = new Map();

const labelKey = (labels) =>
  Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/(["\\])/g, "\\$1").replace(/\n/g, "\\n")}"`)
    .join(",");

/** Add `n` to a counter (labelled). */
export function addCounter(name, help, labels = {}, n = 1) {
  const c = counters.get(name) ?? { help, values: new Map() };
  const key = labelKey(labels);
  c.values.set(key, (c.values.get(key) ?? 0) + n);
  counters.set(name, c);
}

/** Record `value` (seconds) in a labelled histogram with cumulative buckets. */
export function observeHistogram(name, help, labels, value, buckets = DEFAULT_BUCKETS) {
  const h = histograms.get(name) ?? { help, buckets, series: new Map() };
  const key = labelKey(labels);
  let s = h.series.get(key);
  if (!s) {
    s = { counts: new Array(h.buckets.length).fill(0), sum: 0, count: 0 };
    h.series.set(key, s);
  }
  h.buckets.forEach((le, i) => {
    if (value <= le) s.counts[i] += 1;
  });
  s.sum += value;
  s.count += 1;
  histograms.set(name, h);
}

/** Register a gauge whose value is read lazily at scrape time. */
export function registerGauge(name, help, getter) {
  gauges.set(name, { help, getter });
}

function renderHistogramsAndGauges() {
  let out = "";
  for (const [name, { help, buckets, series }] of histograms) {
    out += `# HELP ${name} ${help}\n# TYPE ${name} histogram\n`;
    for (const [labels, s] of series) {
      const sep = labels ? `${labels},` : "";
      buckets.forEach((le, i) => {
        out += `${name}_bucket{${sep}le="${le}"} ${s.counts[i]}\n`;
      });
      out += `${name}_bucket{${sep}le="+Inf"} ${s.count}\n`;
      out += `${name}_sum${labels ? `{${labels}}` : ""} ${s.sum}\n`;
      out += `${name}_count${labels ? `{${labels}}` : ""} ${s.count}\n`;
    }
  }
  for (const [name, { help, getter }] of gauges) {
    let v;
    try {
      v = Number(getter());
    } catch {
      continue;
    }
    if (!Number.isFinite(v)) continue;
    out += `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${v}\n`;
  }
  return out;
}
