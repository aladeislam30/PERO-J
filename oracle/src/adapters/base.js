/** Failure reaching a provider. `retryable` marks transient conditions. */
export class AdapterRequestError extends Error {
  constructor(message, { retryable = false, status, retryAfterMs, cause } = {}) {
    super(message, { cause });
    this.name = "AdapterRequestError";
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Provider answered, but the payload cannot be trusted as an outcome. */
export class AdapterDataError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AdapterDataError";
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Token bucket shared by every request an adapter makes. Waiters reserve
 * tokens synchronously, so concurrent callers queue instead of bursting.
 */
export class TokenBucket {
  constructor({ capacity, refillPerSecond, now = Date.now, sleep = defaultSleep }) {
    if (!(Number.isFinite(capacity) && capacity >= 1)) {
      throw new RangeError("capacity must be at least 1");
    }
    if (!(Number.isFinite(refillPerSecond) && refillPerSecond > 0)) {
      throw new RangeError("refillPerSecond must be a positive number");
    }
    this.capacity = capacity;
    this.refillPerMs = refillPerSecond / 1000;
    this.now = now;
    this.sleep = sleep;
    this.tokens = capacity;
    this.updatedAt = now();
  }

  /** Reserve a token and wait until it is available. */
  async acquire() {
    const now = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + Math.max(0, now - this.updatedAt) * this.refillPerMs,
    );
    this.updatedAt = now;
    this.tokens -= 1;
    if (this.tokens < 0) {
      await this.sleep(Math.ceil(-this.tokens / this.refillPerMs));
    }
  }
}

function parseRetryAfter(value) {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

/**
 * Base class for data providers. Subclasses implement `resolve(params)` and
 * return a boolean outcome (true = YES), throwing when none can be trusted.
 * Every HTTP attempt, retries included, consumes a rate-limit token.
 */
export class BaseAdapter {
  constructor({
    name,
    rateLimit,
    maxRetries = 2,
    baseDelayMs = 250,
    maxDelayMs = 5_000,
    timeoutMs = 10_000,
    fetchImpl,
    sleep = defaultSleep,
    now = Date.now,
  }) {
    if (new.target === BaseAdapter) {
      throw new TypeError("BaseAdapter is abstract");
    }
    if (typeof name !== "string" || name === "") {
      throw new TypeError("Adapter name is required");
    }
    this.name = name;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.timeoutMs = timeoutMs;
    // Looked up per call so a replaced global fetch is honoured.
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.sleep = sleep;
    this.limiter = new TokenBucket({ ...rateLimit, sleep, now });
    /** Bound form, usable as the `fetchImpl` of the factory adapters. */
    this.fetch = this.fetch.bind(this);
  }

  /**
   * @param {object} _params market parameters
   * @returns {Promise<boolean>}
   */
  async resolve(_params) {
    throw new Error(`${this.name}: resolve() is not implemented`);
  }

  /** Rate-limited, retrying GET whose body has been fully received. */
  async fetch(url, { headers = {} } = {}) {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire();
      try {
        return await this.#attempt(url, headers);
      } catch (err) {
        if (!err.retryable || attempt >= this.maxRetries) {
          throw err;
        }
        // A provider asking for a longer pause than we allow is not retried.
        if (err.retryAfterMs > this.maxDelayMs) {
          throw err;
        }
        const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
        await this.sleep(Math.max(err.retryAfterMs ?? 0, backoff));
      }
    }
  }

  async getJson(url, options) {
    const response = await this.fetch(url, options);
    try {
      return await response.json();
    } catch (cause) {
      throw new AdapterDataError(`${this.name}: response is not valid JSON`, { cause });
    }
  }

  async #attempt(url, headers) {
    // Messages never include the URL: it may carry an API key.
    let response;
    let body;
    try {
      response = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await response.text();
    } catch (cause) {
      throw new AdapterRequestError(
        cause?.name === "TimeoutError"
          ? `${this.name}: request timed out after ${this.timeoutMs}ms`
          : `${this.name}: network request failed`,
        { retryable: true, cause },
      );
    }
    if (!response.ok) {
      throw new AdapterRequestError(`${this.name}: responded HTTP ${response.status}`, {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      });
    }
    return { ok: true, status: response.status, json: async () => JSON.parse(body) };
  }
}

/** Accepts a positive number or non-empty numeric string; rejects all else. */
export function parsePrice(value, source) {
  const isNumeric =
    typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  const price = isNumeric ? Number(value) : NaN;
  if (!Number.isFinite(price) || price <= 0) {
    throw new AdapterDataError(`${source}: missing or invalid price`);
  }
  return price;
}

export function priceOutcome(price, { threshold, comparator = "gte" }) {
  const isNumeric =
    typeof threshold === "number" ||
    (typeof threshold === "string" && threshold.trim() !== "");
  const limit = isNumeric ? Number(threshold) : NaN;
  if (!Number.isFinite(limit)) {
    throw new AdapterDataError("market threshold must be a finite number");
  }
  if (comparator !== "gte" && comparator !== "lte") {
    throw new AdapterDataError(`unsupported comparator "${comparator}"`);
  }
  return comparator === "lte" ? price <= limit : price >= limit;
}
