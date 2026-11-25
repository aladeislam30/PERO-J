import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import {
  CHECK_INTERVAL_MS,
  checkCouncilInactivity,
  getCouncilInactivityConfig,
  startCouncilInactivityMonitor,
  type ActiveDispute,
} from "../src/monitors/council-inactivity.ts";

const NOW = 1_800_000_000_000;
const config = {
  contractId: "C1",
  routingKey: "key",
  roster: ["G1", "G2", "G3"],
  quorum: 2,
};

function dispute(elapsedHours: number, voters: string[] = [], id = 17n) {
  return {
    id,
    submission_id: 42n,
    deadline_unix_seconds: BigInt(NOW / 1000 + (72 - elapsedHours) * 3600),
    votes: voters.map((member) => ({ member })),
  } satisfies ActiveDispute;
}

function recorder(ok: (body: any) => boolean = () => true) {
  const calls: any[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    return { ok: ok(body), status: 500, text: async () => "unavailable" };
  };
  return { calls, fetchImpl };
}

describe("council inactivity monitor", () => {
  it("loads config and validates quorum", () => {
    const env = {
      ORACLE_CONTRACT_ID: "C1",
      PAGERDUTY_ROUTING_KEY: "key",
      ORACLE_COUNCIL_ROSTER: "G1, G2,G3,G3",
    };
    assert.deepEqual(getCouncilInactivityConfig(env), config);
    assert.equal(
      getCouncilInactivityConfig({ ...env, PAGERDUTY_ROUTING_KEY: "" }),
      null,
    );
    assert.throws(
      () => getCouncilInactivityConfig({ ...env, ORACLE_COUNCIL_QUORUM: "4" }),
      /ORACLE_COUNCIL_QUORUM/,
    );
  });

  it("checks hourly", () => assert.equal(CHECK_INTERVAL_MS, 3_600_000));

  it("escalates exactly once at each of 24h, 48h and 60h", async () => {
    const { calls, fetchImpl } = recorder();
    const notified = new Map();
    for (let hour = 0; hour <= 72; hour++) {
      await checkCouncilInactivity({
        disputes: [dispute(hour, ["G1"])],
        config,
        notified,
        now: NOW,
        fetchImpl,
      });
    }
    assert.deepEqual(
      calls.map((c) => c.payload.custom_details.hours_without_quorum),
      [24, 48, 60],
    );
    assert.deepEqual(
      calls.map((c) => c.payload.severity),
      ["warning", "warning", "critical"],
    );
    assert.deepEqual(calls[0].payload.custom_details.council_roster, config.roster);
    assert.deepEqual(calls[0].payload.custom_details.pending_members, ["G2", "G3"]);
  });

  it("sends only the latest milestone when several passed unnoticed", async () => {
    const { calls, fetchImpl } = recorder();
    await checkCouncilInactivity({
      disputes: [dispute(61)],
      config,
      notified: new Map(),
      now: NOW,
      fetchImpl,
    });
    assert.deepEqual(
      calls.map((c) => c.dedup_key),
      ["peroj-oracle-dispute-17-council-inactivity-60h"],
    );
  });

  it("ignores duplicate votes and votes from outside the roster", async () => {
    const { calls, fetchImpl } = recorder();
    await checkCouncilInactivity({
      disputes: [dispute(30, ["G1", "G1", "GX"])],
      config,
      notified: new Map(),
      now: NOW,
      fetchImpl,
    });
    assert.equal(calls[0].payload.custom_details.votes_cast, 1);
  });

  for (const [name, next] of [
    ["quorum is reached", [dispute(26, ["G1", "G2"])]],
    ["the dispute closes", []],
  ] as [string, ActiveDispute[]][]) {
    it(`resolves open incidents when ${name}`, async () => {
      const { calls, fetchImpl } = recorder();
      const notified = new Map();
      const base = { config, notified, now: NOW, fetchImpl };
      await checkCouncilInactivity({ ...base, disputes: [dispute(25)] });
      await checkCouncilInactivity({ ...base, disputes: next });
      assert.equal(notified.size, 0);
      assert.ok(
        calls.some(
          (c) =>
            c.event_action === "resolve" && c.dedup_key === calls[0].dedup_key,
        ),
      );
    });
  }

  it("isolates failures and retries them on the next check", async () => {
    let down = true;
    const { calls, fetchImpl } = recorder(
      (body) => !(down && body.dedup_key.includes("dispute-1-")),
    );
    const notified = new Map();
    const options = {
      disputes: [
        { ...dispute(25), id: "bad" },
        dispute(25, [], 1n),
        dispute(25, [], 2n),
      ],
      config,
      notified,
      now: NOW,
      fetchImpl,
    };
    await assert.rejects(checkCouncilInactivity(options), /PagerDuty.*500/);
    assert.deepEqual([...notified.keys()], ["2"]);

    down = false;
    options.disputes.shift();
    assert.equal(await checkCouncilInactivity(options), 1);
    assert.equal(calls.length, 3);
  });

  it("accepts disputes as decoded from contract values", async () => {
    const member = Keypair.random().publicKey();
    const { calls, fetchImpl } = recorder();
    const encoded = nativeToScVal(
      [{ ...dispute(30), votes: [{ member, vote: ["Affirmative"] }] }],
      { type: {} } as any,
    );
    await checkCouncilInactivity({
      disputes: scValToNative(encoded),
      config: { ...config, roster: [member, "G2", "G3"] },
      notified: new Map(),
      now: NOW,
      fetchImpl,
    });
    assert.equal(calls[0].payload.custom_details.votes_cast, 1);
  });

  it("keeps running after a failed check until stopped", async () => {
    let checks = 0;
    await new Promise<void>((resolve) => {
      const stop = startCouncilInactivityMonitor({
        config,
        intervalMs: 1,
        fetchActive: async () => {
          if (++checks === 2) {
            stop();
            resolve();
            return [];
          }
          throw new Error("rpc down");
        },
      });
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(checks, 2);
  });
});
