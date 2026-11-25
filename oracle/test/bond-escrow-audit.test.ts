import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollOnce } from "../src/daemon.js";
import { submitExpiredMarket } from "../src/workers/auto-submitter.js";
import {
  BondEscrowGuard,
  auditBondEscrow,
  evaluateInvariant,
  getBondAuditConfig,
  startBondEscrowAudit,
  type BondAccounting,
} from "../src/workers/bond-escrow-audit.ts";

const config = { escrowContractId: "C1", routingKey: "key", intervalMs: 1_000 };

function accounting(overrides: Partial<BondAccounting> = {}): BondAccounting {
  return {
    deposited: "100",
    settled: "40",
    active_disputes: 2,
    invalid_bonds: [],
    ...overrides,
  };
}

/** Mimics the statements the guard issues; the breaker outlives any guard. */
class FakeDb {
  accounting = accounting();
  breaker: any = null;
  failBreaker = false;
  async query(text: string, params: any[] = []) {
    if (text.includes("FROM dispute_bonds")) {
      return { rows: [this.accounting] };
    }
    if (this.failBreaker) {
      throw new Error("db down");
    }
    if (text.startsWith("INSERT")) {
      if (!this.breaker?.tripped) {
        this.breaker = {
          tripped: true,
          reason: params[1],
          details: JSON.parse(params[2]),
          alerted: false,
        };
      }
    } else if (text.includes("SET tripped = FALSE")) {
      if (this.breaker) this.breaker.tripped = false;
    } else if (text.includes("SET alerted = TRUE")) {
      this.breaker.alerted = true;
    } else if (text.includes("NOT alerted")) {
      const pending = this.breaker?.tripped && !this.breaker.alerted;
      return { rows: pending ? [this.breaker] : [] };
    } else if (this.breaker) {
      return { rows: [this.breaker] };
    }
    return { rows: [] };
  }
}

function setup(db = new FakeDb()) {
  const state = { balance: 60n, pagerDutyUp: true, now: 0, calls: [] as any[] };
  const guard = new BondEscrowGuard(db, config, {
    fetchBalance: async () => state.balance,
    now: () => state.now,
    fetchImpl: async (_url, init) => {
      state.calls.push(JSON.parse(String(init.body)));
      return { ok: state.pagerDutyUp, status: 500, text: async () => "down" };
    },
  });
  return { db, guard, state };
}

describe("invariant", () => {
  it("holds only on an exact match", () => {
    assert.equal(evaluateInvariant(accounting(), 60n).valid, true);
    assert.equal(evaluateInvariant(accounting(), 59n).details.discrepancy, "-1");
    assert.equal(evaluateInvariant(accounting(), 61n).valid, false);
  });

  it("detects one stroop beyond float precision", () => {
    const big = accounting({ deposited: "9007199254740993", settled: "0" });
    assert.equal(evaluateInvariant(big, 9007199254740993n).valid, true);
    assert.equal(evaluateInvariant(big, 9007199254740992n).valid, false);
  });

  it("fails on inconsistent bonds even when totals match", () => {
    const result = evaluateInvariant(
      accounting({ invalid_bonds: [{ id: "b", dispute_id: "d" }] }),
      60n,
    );
    assert.equal(result.valid, false);
  });

  it("re-reads the balance when accounting changes mid-audit", async () => {
    const db = new FakeDb();
    let reads = 0;
    const result = await auditBondEscrow(db, async () => {
      if (++reads === 1) {
        db.accounting = accounting({ deposited: "110" });
        return 60n;
      }
      return 70n;
    });
    assert.equal(result.valid, true);
    assert.equal(reads, 2);
  });

  it("validates config", () => {
    assert.equal(getBondAuditConfig({}), null);
    assert.throws(
      () =>
        getBondAuditConfig({
          BOND_ESCROW_CONTRACT_ID: "C1",
          BOND_AUDIT_INTERVAL_MS: "x",
        }),
      /BOND_AUDIT_INTERVAL_MS/,
    );
  });
});

describe("circuit breaker", () => {
  it("blocks until the first pass, then allows", async () => {
    const { guard } = setup();
    assert.equal(await guard.isResolutionAllowed(), false);
    await guard.check();
    assert.equal(await guard.isResolutionAllowed(), true);
  });

  it("trips and alerts immediately, once, and survives recovery and restart", async () => {
    const { db, guard, state } = setup();
    await guard.check();
    state.balance = 59n;
    await guard.check();
    assert.equal(await guard.isResolutionAllowed(), false);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].payload.severity, "critical");

    state.balance = 60n;
    await guard.check();
    assert.equal(await guard.isResolutionAllowed(), false);
    assert.equal(state.calls.length, 1);

    const restarted = setup(db).guard;
    await restarted.check();
    assert.equal(await restarted.isResolutionAllowed(), false);
  });

  it("retries a failed alert", async () => {
    const { db, guard, state } = setup();
    state.balance = 0n;
    state.pagerDutyUp = false;
    await guard.check();
    assert.equal(db.breaker.alerted, false);
    state.pagerDutyUp = true;
    await guard.check();
    await guard.check();
    assert.equal(db.breaker.alerted, true);
    assert.equal(state.calls.length, 2);
  });

  it("still halts, alerts and latches when the trip cannot be saved", async () => {
    const { db, guard, state } = setup();
    db.failBreaker = true;
    state.balance = 0n;
    await guard.check();
    assert.equal(state.calls.length, 1);
    db.failBreaker = false;
    assert.equal(await guard.isResolutionAllowed(), false);
    state.balance = 60n;
    await guard.check();
    assert.equal(db.breaker.tripped, true);
    assert.equal(await guard.isResolutionAllowed(), false);
  });

  it("blocks when audits go stale or the breaker is unreadable", async () => {
    const { db, guard, state } = setup();
    await guard.check();
    state.now = 3_001;
    assert.equal(await guard.isResolutionAllowed(), false);
    state.now = 0;
    db.failBreaker = true;
    assert.equal(await guard.isResolutionAllowed(), false);
  });

  it("resets only when the invariant holds", async () => {
    const { guard, state } = setup();
    state.balance = 0n;
    await guard.check();
    assert.equal((await guard.reset()).valid, false);
    assert.equal(await guard.isResolutionAllowed(), false);
    state.balance = 60n;
    assert.equal((await guard.reset()).valid, true);
    assert.equal(await guard.isResolutionAllowed(), true);
    assert.equal(state.calls.at(-1).event_action, "resolve");
  });

  it("audits continuously, including after errors", async () => {
    let checks = 0;
    await new Promise<void>((resolve) => {
      const stop = startBondEscrowAudit(
        {
          check: async () => {
            if (++checks === 3) {
              stop();
              resolve();
            }
            throw new Error("rpc down");
          },
        },
        1,
      );
    });
    assert.equal(checks, 3);
  });
});

describe("automated resolution", () => {
  it("stops the poll when the breaker trips part-way", async () => {
    const submitted: string[] = [];
    const db = { query: async () => ({ rows: [{ id: "a" }, { id: "b" }] }) };
    await pollOnce(
      db as any,
      (async (_db: unknown, market: { id: string }) => {
        submitted.push(market.id);
        return true;
      }) as any,
      async () => submitted.length === 0,
    );
    assert.deepEqual(submitted, ["a"]);
  });

  it("releases the market when halted after the outcome was fetched", async () => {
    const statements: string[] = [];
    let onChain = false;
    const result = await submitExpiredMarket(
      {
        query: async (text: string) => {
          statements.push(text);
          return { rowCount: 1 };
        },
      },
      { id: "a", category: "crypto", params: {} },
      {
        determine: async () => true,
        submit: async () => {
          onChain = true;
        },
        canResolve: async () => false,
      },
    );
    assert.equal(result, false);
    assert.equal(onChain, false);
    assert.match(statements.at(-1)!, /status = 'open'/);
  });
});
