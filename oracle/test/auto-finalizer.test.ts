import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import pg from "pg";
import { challengeWindowSeconds } from "../src/challenge-window.js";
import { invokeMarketContract } from "../src/market-contract.js";
import { finalizeUncontestedMarkets } from "../src/workers/auto-finalizer.js";

const WINDOW = 3600;

describe("finalizeUncontestedMarkets", () => {
  it("restores the row and continues when one market fails", async () => {
    const writes: unknown[][] = [];
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith("SELECT"))
          return {
            rows: [
              { id: "bad", status: "submitted" },
              { id: "good", status: "submitted" },
            ],
          };
        writes.push([sql.includes("'resolved', oracle_state") ? "resolved" : sql, ...params]);
        return { rowCount: 1, rows: [] };
      },
    };
    const result = await finalizeUncontestedMarkets(db, {
      windowSeconds: WINDOW,
      finalize: async (id: string) => {
        if (id === "bad") throw new Error("rpc down");
      },
    });
    assert.deepEqual(result, { finalized: 1, failed: 1 });
    assert.ok(writes.some((w) => w[1] === "bad" && w[2] === "submitted"));
    assert.ok(writes.some((w) => w[0] === "resolved" && w[1] === "good"));
  });
});

describe("challengeWindowSeconds", () => {
  it("defaults to 72 hours and rejects invalid values", () => {
    assert.equal(challengeWindowSeconds({}), 259_200);
    assert.throws(() => challengeWindowSeconds({ ORACLE_CHALLENGE_WINDOW_SECONDS: "0" }));
    assert.throws(() => challengeWindowSeconds({ ORACLE_CHALLENGE_WINDOW_SECONDS: "72h" }));
  });
});

describe("invokeMarketContract", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PERO_MARKET_CONTRACT_ID = "CTEST";
    process.env.ORACLE_HOT_WALLET_SECRET = "STESTSECRET";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("never leaks the worker key in errors", async () => {
    const exec = async () => {
      throw Object.assign(new Error("Command failed: --source STESTSECRET"), {
        stderr: "bad source STESTSECRET",
      });
    };
    await assert.rejects(
      invokeMarketContract("finalize_outcome", { market_id: "1" }, exec as never),
      (err: Error) => /redacted/.test(err.message) && !err.message.includes("STESTSECRET"),
    );
  });

  it("serializes calls", async () => {
    let active = 0;
    let peak = 0;
    const exec = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };
    await Promise.all(
      ["1", "2", "3"].map((id) =>
        invokeMarketContract("finalize_outcome", { market_id: id }, exec as never),
      ),
    );
    assert.equal(peak, 1);
  });
});

// Runs the eligibility SQL for real when a disposable database is provided.
describe("eligibility (Postgres)", { skip: !process.env.ORACLE_TEST_DATABASE_URL }, () => {
  let db: any;
  before(async () => {
    db = new pg.Client({ connectionString: process.env.ORACLE_TEST_DATABASE_URL });
    await db.connect();
    // Temporary tables shadow real ones and vanish with the connection.
    await db.query(`
      CREATE TEMP TABLE markets (id TEXT PRIMARY KEY, status TEXT, oracle_state TEXT,
        challenge_deadline TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TEMP TABLE oracle_submissions (id BIGSERIAL PRIMARY KEY, market_id TEXT,
        ledger BIGINT, status TEXT, timestamp TIMESTAMPTZ);
      CREATE TEMP TABLE oracle_disputes (id BIGSERIAL PRIMARY KEY, submission_id BIGINT);
    `);
  });
  after(() => db?.end());

  it("finalizes only uncontested, expired submissions", async () => {
    await db.query(`
      INSERT INTO markets (id, status, oracle_state, challenge_deadline, updated_at) VALUES
        ('due', 'submitted', 'submitted', NOW() - INTERVAL '1 second', NOW()),
        ('unindexed', 'submitted', 'pending', NOW() - INTERVAL '1 second', NOW()),
        ('early', 'submitted', 'submitted', NOW() + INTERVAL '1 hour', NOW()),
        ('disputed', 'submitted', 'disputed', NOW() - INTERVAL '1 hour', NOW()),
        ('dispute-row', 'submitted', 'submitted', NOW() - INTERVAL '1 hour', NOW()),
        ('third-party', 'open', 'submitted', NULL, NOW()),
        ('third-early', 'open', 'submitted', NULL, NOW()),
        ('plain-open', 'open', 'pending', NULL, NOW()),
        ('in-flight', 'finalizing', 'submitted', NOW() - INTERVAL '1 hour', NOW()),
        ('crashed', 'finalizing', 'submitted', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '3 minutes'),
        ('external', 'submitted', 'finalized', NOW() - INTERVAL '1 hour', NOW());
      INSERT INTO oracle_submissions (id, market_id, ledger, status, timestamp) VALUES
        (101, 'third-party', 1, 'pending', NOW() - INTERVAL '2 hours'),
        (102, 'third-early', 1, 'pending', NOW()),
        (103, 'dispute-row', 1, 'disputed', NOW() - INTERVAL '2 hours');
      INSERT INTO oracle_disputes (submission_id) VALUES (103);
    `);
    const called: string[] = [];
    const run = () =>
      finalizeUncontestedMarkets(db, {
        windowSeconds: WINDOW,
        finalize: async (id: string) => void called.push(id),
      });
    assert.deepEqual(await run(), { finalized: 4, failed: 0 });
    assert.deepEqual(called.sort(), ["crashed", "due", "third-party", "unindexed"]);
    assert.deepEqual(await run(), { finalized: 0, failed: 0 });
    const { rows } = await db.query(
      "SELECT id FROM markets WHERE status = 'resolved' ORDER BY id",
    );
    assert.deepEqual(
      rows.map((r: { id: string }) => r.id),
      ["crashed", "due", "external", "third-party", "unindexed"],
    );
  });
});
