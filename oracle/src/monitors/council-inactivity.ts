import {
  resolveIncident,
  triggerIncident,
  type FetchImpl,
} from "../lib/pagerduty.ts";
import { simulateRead } from "../lib/soroban.ts";

const HOUR_SECONDS = 60 * 60;
const VOTING_PERIOD_SECONDS = 72 * HOUR_SECONDS;
export const ESCALATION_HOURS = [24, 48, 60] as const;
export const CHECK_INTERVAL_MS = HOUR_SECONDS * 1000;

export interface ActiveDispute {
  id: bigint | number | string;
  submission_id: bigint | number | string;
  deadline_unix_seconds: bigint | number | string;
  votes: { member: string }[];
}

export interface CouncilInactivityConfig {
  contractId: string;
  routingKey: string;
  roster: string[];
  quorum: number;
}

interface DisputeProgress {
  id: string;
  submissionId: string;
  deadlineSeconds: number;
  elapsedSeconds: number;
  voted: string[];
  pending: string[];
}

/** Highest milestone already notified, per dispute id. */
export type NotifiedMilestones = Map<string, number>;

/**
 * Read the monitor configuration, or null when a required setting is missing.
 * Quorum defaults to a strict majority of the roster.
 */
export function getCouncilInactivityConfig(
  env: NodeJS.ProcessEnv = process.env,
): CouncilInactivityConfig | null {
  const contractId = env.ORACLE_CONTRACT_ID?.trim();
  const routingKey = env.PAGERDUTY_ROUTING_KEY?.trim();
  const roster = [
    ...new Set(
      (env.ORACLE_COUNCIL_ROSTER ?? "")
        .split(",")
        .map((member) => member.trim())
        .filter(Boolean),
    ),
  ];
  if (!contractId || !routingKey || roster.length === 0) {
    return null;
  }

  const rawQuorum = env.ORACLE_COUNCIL_QUORUM?.trim();
  const quorum = rawQuorum
    ? Number(rawQuorum)
    : Math.floor(roster.length / 2) + 1;
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > roster.length) {
    throw new Error(
      "ORACLE_COUNCIL_QUORUM must be an integer between 1 and the council roster size",
    );
  }
  return { contractId, routingKey, roster, quorum };
}

/** Fetch active disputes, with their council votes, from the oracle contract. */
export async function fetchActiveDisputes(
  contractId: string,
): Promise<ActiveDispute[]> {
  const value = await simulateRead(contractId, "get_active_disputes");
  if (!Array.isArray(value)) {
    throw new Error("get_active_disputes must return an array");
  }
  return value as ActiveDispute[];
}

function integerField(value: unknown, field: string): string {
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid dispute field: ${field}`);
  }
  return text;
}

function readProgress(
  dispute: ActiveDispute,
  roster: string[],
  nowSeconds: number,
): DisputeProgress {
  const deadlineSeconds = Number(
    integerField(dispute.deadline_unix_seconds, "deadline_unix_seconds"),
  );
  // Rejects values Date cannot represent, which would break the alert payload.
  if (Number.isNaN(new Date(deadlineSeconds * 1000).getTime())) {
    throw new Error("Invalid dispute field: deadline_unix_seconds");
  }
  if (!Array.isArray(dispute.votes)) {
    throw new Error("Invalid dispute field: votes");
  }
  // Only distinct current council members count toward quorum.
  const members = new Set(dispute.votes.map((vote) => vote?.member));
  return {
    id: integerField(dispute.id, "id"),
    submissionId: integerField(dispute.submission_id, "submission_id"),
    deadlineSeconds,
    elapsedSeconds: nowSeconds - (deadlineSeconds - VOTING_PERIOD_SECONDS),
    voted: roster.filter((member) => members.has(member)),
    pending: roster.filter((member) => !members.has(member)),
  };
}

// Same format as the indexer's monitor, so running both never pages twice.
function dedupKey(disputeId: string, hours: number): string {
  return `peroj-oracle-dispute-${disputeId}-council-inactivity-${hours}h`;
}

async function escalate(
  progress: DisputeProgress,
  hours: number,
  config: CouncilInactivityConfig,
  fetchImpl: FetchImpl,
): Promise<void> {
  await triggerIncident(
    config.routingKey,
    {
      dedupKey: dedupKey(progress.id, hours),
      summary: `Oracle dispute ${progress.id} has no council quorum after ${hours} hours (${progress.voted.length}/${config.quorum} votes)`,
      severity: hours >= 60 ? "critical" : "warning",
      source: "PERO-J Oracle council inactivity monitor",
      component: "oracle",
      group: "council",
      class: "council-inactivity",
      details: {
        dispute_id: progress.id,
        submission_id: progress.submissionId,
        hours_without_quorum: hours,
        votes_cast: progress.voted.length,
        quorum: config.quorum,
        council_roster: config.roster,
        pending_members: progress.pending,
        voting_deadline: new Date(progress.deadlineSeconds * 1000).toISOString(),
      },
    },
    fetchImpl,
  );
}

async function resolveAll(
  disputeId: string,
  config: CouncilInactivityConfig,
  fetchImpl: FetchImpl,
): Promise<void> {
  for (const hours of ESCALATION_HOURS) {
    await resolveIncident(
      config.routingKey,
      dedupKey(disputeId, hours),
      fetchImpl,
    );
  }
}

/**
 * Check every active dispute once. Each milestone is notified once; if several
 * passed since the last check (e.g. after downtime) only the latest is sent.
 * A failure on one dispute does not stop the others and is retried next check.
 *
 * @returns the number of escalations dispatched
 */
export async function checkCouncilInactivity({
  disputes,
  config,
  notified,
  now = Date.now(),
  fetchImpl = fetch,
}: {
  disputes: ActiveDispute[];
  config: CouncilInactivityConfig;
  notified: NotifiedMilestones;
  now?: number;
  fetchImpl?: FetchImpl;
}): Promise<number> {
  const nowSeconds = Math.floor(now / 1000);
  const activeIds = new Set(disputes.map((dispute) => String(dispute?.id)));
  const failures: unknown[] = [];
  let sent = 0;

  for (const id of [...notified.keys()]) {
    if (activeIds.has(id)) {
      continue;
    }
    try {
      await resolveAll(id, config, fetchImpl);
      notified.delete(id);
    } catch (err) {
      failures.push(err);
    }
  }

  for (const dispute of disputes) {
    try {
      const progress = readProgress(dispute, config.roster, nowSeconds);
      const previous = notified.get(progress.id);

      if (progress.voted.length >= config.quorum) {
        if (previous !== undefined) {
          await resolveAll(progress.id, config, fetchImpl);
          notified.delete(progress.id);
        }
        continue;
      }

      const due = ESCALATION_HOURS.filter(
        (hours) => progress.elapsedSeconds >= hours * HOUR_SECONDS,
      ).at(-1);
      if (due !== undefined && due > (previous ?? 0)) {
        await escalate(progress, due, config, fetchImpl);
        notified.set(progress.id, due);
        sent++;
      }
    } catch (err) {
      failures.push(err);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length} council inactivity check(s) failed: ${failures
        .map((err) => (err instanceof Error ? err.message : String(err)))
        .join("; ")}`,
    );
  }
  return sent;
}

/**
 * Check now and then every hour. Returns a function that stops the monitor.
 */
export function startCouncilInactivityMonitor({
  config,
  fetchActive = () => fetchActiveDisputes(config.contractId),
  fetchImpl = fetch,
  intervalMs = CHECK_INTERVAL_MS,
}: {
  config: CouncilInactivityConfig;
  fetchActive?: () => Promise<ActiveDispute[]>;
  fetchImpl?: FetchImpl;
  intervalMs?: number;
}): () => void {
  const notified: NotifiedMilestones = new Map();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const check = async () => {
    try {
      const sent = await checkCouncilInactivity({
        disputes: await fetchActive(),
        config,
        notified,
        fetchImpl,
      });
      if (sent > 0) {
        console.log(`[council-inactivity] dispatched ${sent} escalation(s)`);
      }
    } catch (err) {
      console.error("[council-inactivity] check failed:", err);
    }
    if (!stopped) {
      timer = setTimeout(check, intervalMs);
    }
  };

  void check();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
