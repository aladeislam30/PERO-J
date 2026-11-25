// Self-test: node scripts/lint-migrations.test.js
import assert from "node:assert/strict";
import { lintMigrations } from "./lint-migrations.js";

const fx = (n) => new URL(`./__fixtures__/${n}`, import.meta.url).pathname;
assert.deepEqual(lintMigrations(fx("migrations-ok")), []);
assert.match(lintMigrations(fx("migrations-dup")).join("\n"), /duplicate prefix 0001/);
assert.match(lintMigrations(fx("migrations-gap")).join("\n"), /expected prefix 0002/);
assert.match(lintMigrations(fx("migrations-destructive")).join("\n"), /DROP TABLE requires/);
assert.match(lintMigrations(fx("migrations-nonidem")).join("\n"), /CREATE TABLE without IF NOT EXISTS/);
console.log("lint-migrations self-test passed");
