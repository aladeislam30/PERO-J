import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Per-request context propagated through async calls (HTTP -> DB -> logs).
 * Store shape: { requestId: string }.
 */
const storage = new AsyncLocalStorage();

/** Accepted inbound X-Request-ID: 1-128 chars of [A-Za-z0-9._:-]. */
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function isValidRequestId(value) {
  return typeof value === "string" && REQUEST_ID_RE.test(value);
}

/** @returns {string|undefined} request id of the current async context, if any */
export function getRequestId() {
  return storage.getStore()?.requestId;
}

export function runWithRequestId(requestId, fn) {
  return storage.run({ requestId }, fn);
}

/**
 * Prefix a SQL string with a `/* request_id=... *\/` comment when a request
 * context is active. The id charset can never contain `*` or `/`.
 */
export function tagSqlWithRequestId(text) {
  const id = getRequestId();
  if (!id || typeof text !== "string") return text;
  return `/* request_id=${id} */ ${text}`;
}

let consolePatched = false;

/** Prefix console.* output with `[request_id=<id>]` inside a request context. */
export function installConsoleRequestId() {
  if (consolePatched) return;
  consolePatched = true;
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const id = getRequestId();
      if (id) original(`[request_id=${id}]`, ...args);
      else original(...args);
    };
  }
}

/** Express middleware: read or generate X-Request-ID, echo it, open context. */
export function requestIdMiddleware(req, res, next) {
  installConsoleRequestId();
  const inbound = req.headers["x-request-id"];
  const requestId = isValidRequestId(inbound) ? inbound : randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  storage.run({ requestId }, next);
}
