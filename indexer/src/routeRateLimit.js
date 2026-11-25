/**
 * Granular per-route rate limiting (fixed window, in-memory, per client IP).
 *
 * Buckets (issue #1149):
 *   - oracle submit/challenge (POST /oracle/*, POST /disputes/bonds*) : 10 / min
 *   - bettor history & profile (/bets, /wallet*, /profile*, /leaderboard) : 60 / min
 *   - public market reads (/markets*)                                   : 120 / min
 *   - everything else under /api                                         : 100 / min
 */
export const WINDOW_MS = 60_000;

/** First matching policy wins. `path` is relative to /api[/v1]. */
export const ROUTE_POLICIES = [
  { name: "oracle-write", methods: ["POST"], pattern: /^\/(oracle|disputes\/bonds)(\/|$)/, max: 10 },
  { name: "bettor", methods: null, pattern: /^\/(bets|wallet|profile|leaderboard)(\/|$)/, max: 60 },
  { name: "market-read", methods: ["GET", "HEAD"], pattern: /^\/markets(\/|$)/, max: 120 },
];
export const DEFAULT_POLICY = { name: "default", methods: null, pattern: /./, max: 100 };

export function resolvePolicy(method, apiPath, policies = ROUTE_POLICIES) {
  const rel = apiPath.replace(/^\/api(\/v1)?(?=\/|$)/, "") || "/";
  for (const p of policies) {
    if (p.pattern.test(rel) && (!p.methods || p.methods.includes(method))) return p;
  }
  return DEFAULT_POLICY;
}

/**
 * @param {{ policies?: typeof ROUTE_POLICIES, windowMs?: number, now?: () => number }} [opts]
 */
export function createRouteRateLimiter(opts = {}) {
  const policies = opts.policies ?? ROUTE_POLICIES;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const now = opts.now ?? Date.now;
  const hits = new Map(); // `${bucket}|${ip}` -> { count, resetAt }

  return function routeRateLimit(req, res, next) {
    const apiPath = (req.originalUrl || req.url).split("?")[0];
    const policy = resolvePolicy(req.method, apiPath, policies);
    req.perRouteRateLimited = true;

    const t = now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    const key = `${policy.name}|${req.ip}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, policy.max - entry.count);
    const resetSec = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    res.setHeader("RateLimit-Limit", String(policy.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSec));
    res.setHeader("X-RateLimit-Limit", String(policy.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > policy.max) {
      res.setHeader("Retry-After", String(resetSec));
      return res.status(429).json({
        error: "Too many requests",
        bucket: policy.name,
        retry_after_seconds: resetSec,
      });
    }
    next();
  };
}

export const routeRateLimit = createRouteRateLimiter();
