import { disputes as configuredDisputes } from "./config";
import type { CouncilSide, Dispute } from "./types";

const STORAGE_PREFIX = "pero-j:dispute:";
export const DISPUTES_CHANGE_EVENT = "disputes-change";

function storageKey(marketId: string): string {
  return `${STORAGE_PREFIX}${marketId}`;
}

export function readDisputes(): Dispute[] {
  const fromStorage = new Map<string, Dispute>();

  if (typeof localStorage !== "undefined") {
    for (const dispute of configuredDisputes) {
      try {
        const raw = localStorage.getItem(storageKey(dispute.marketId));
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isDispute(parsed)) fromStorage.set(dispute.marketId, parsed);
        }
      } catch {
        continue;
      }
    }
  }

  return configuredDisputes.map((dispute) => fromStorage.get(dispute.marketId) ?? dispute);
}

export function readDispute(marketId: string): Dispute | undefined {
  return readDisputes().find((dispute) => dispute.marketId === marketId);
}

export function writeDispute(dispute: Dispute): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(storageKey(dispute.marketId), JSON.stringify(dispute));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(DISPUTES_CHANGE_EVENT));
    }
  } catch {
    return;
  }
}

export function castCouncilVote(marketId: string, voter: string, side: CouncilSide): void {
  const dispute = readDispute(marketId);
  if (!dispute || !voter || dispute.votes.some((vote) => vote.voter === voter)) return;
  if (dispute.votes.length >= dispute.councilSize) return;

  writeDispute({
    ...dispute,
    votes: [...dispute.votes, { voter, side, votedAt: new Date().toISOString() }],
  });
}

function isDispute(value: unknown): value is Dispute {
  if (typeof value !== "object" || value === null) return false;
  const dispute = value as Partial<Dispute>;
  return (
    typeof dispute.marketId === "string" &&
    typeof dispute.marketTitle === "string" &&
    typeof dispute.submitterAddress === "string" &&
    typeof dispute.proposedOutcome === "string" &&
    typeof dispute.submitterBondXlm === "number" &&
    typeof dispute.challengerAddress === "string" &&
    typeof dispute.disputedOutcome === "string" &&
    typeof dispute.challengerBondXlm === "number" &&
    typeof dispute.councilSize === "number" &&
    Array.isArray(dispute.votes) &&
    Array.isArray(dispute.evidenceLinks) &&
    typeof dispute.resolutionDeadline === "string" &&
    Array.isArray(dispute.timeline)
  );
}
