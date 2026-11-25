import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOpenApiDocument } from "../src/openapi.js";

const apiSource = readFileSync(new URL("../src/api.js", import.meta.url), "utf8");

function registeredRoutes() {
  const out = [];
  const re = /\b(v1Router|app)\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
  for (const m of apiSource.matchAll(re)) {
    const path = (m[1] === "v1Router" ? "/api/v1" : "") + m[3].replace(/:([A-Za-z_]+)/g, "{$1}");
    out.push([m[2], path]);
  }
  return out;
}

describe("OpenAPI document (#1150)", () => {
  const doc = buildOpenApiDocument();

  it("is a valid OpenAPI 3 shell", () => {
    assert.match(doc.openapi, /^3\./);
    assert.ok(doc.info.title);
  });

  it("documents every route registered in api.js", () => {
    const missing = registeredRoutes().filter(([m, p]) => !doc.paths[p]?.[m]);
    assert.deepEqual(missing, []);
  });

  it("documents the openapi endpoint itself is served", () => {
    assert.match(apiSource, /registerOpenApi\(app\)/);
  });
});
