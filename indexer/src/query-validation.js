// Allow-list validation for list-endpoint query parameters (issue #1153).
// Dependency-free: the indexer does not ship zod. Values are never interpolated
// into SQL; they are only accepted when they match a fixed allow-list.

export const MARKET_SORT_COLUMNS = Object.freeze([
  "created_at",
  "ends_at",
  "total_volume",
  "bet_count",
]);
export const SORT_ORDERS = Object.freeze(["asc", "desc"]);

function single(value) {
  // Express yields arrays/objects for repeated or nested params (?sort=a&sort=b, ?sort[x]=1).
  return Array.isArray(value) || (value !== null && typeof value === "object") ? undefined : value;
}

/**
 * Validate optional `sort` and `order` query params.
 * Returns { ok: true, sort, order } (both null when absent) or { ok: false, error }.
 */
export function parseSortParams(query = {}, allowedColumns = MARKET_SORT_COLUMNS) {
  const out = { ok: true, sort: null, order: null };
  if (query.sort !== undefined) {
    const sort = single(query.sort);
    if (typeof sort !== "string" || !allowedColumns.includes(sort)) {
      return { ok: false, error: `sort must be one of: ${allowedColumns.join(", ")}` };
    }
    out.sort = sort;
  }
  if (query.order !== undefined) {
    const order = single(query.order);
    const lowered = typeof order === "string" ? order.toLowerCase() : "";
    if (!SORT_ORDERS.includes(lowered)) {
      return { ok: false, error: `order must be one of: ${SORT_ORDERS.join(", ")}` };
    }
    out.order = lowered;
  }
  return out;
}
