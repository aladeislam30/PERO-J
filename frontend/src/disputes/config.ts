import type { Dispute } from "./types";

const submitter = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const challenger = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const council = [
  "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  "GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
  "GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
];

export const disputes: Dispute[] = [
  {
    marketId: "next_ledger",
    marketTitle: "Will the next ledger confirm within 10 seconds?",
    submitterAddress: submitter,
    proposedOutcome: "Yes",
    submitterBondXlm: 250,
    submitterTxHash: "a".repeat(64),
    challengerAddress: challenger,
    disputedOutcome: "No",
    challengerBondXlm: 300,
    challengerTxHash: "b".repeat(64),
    councilSize: 4,
    votes: [
      { voter: council[0], side: "submitter", votedAt: "2026-11-20T10:00:00.000Z" },
      { voter: council[1], side: "submitter", votedAt: "2026-11-20T11:30:00.000Z" },
      { voter: council[2], side: "challenger", votedAt: "2026-11-21T09:15:00.000Z" },
    ],
    evidenceLinks: [
      { label: "Stellar Expert audit trail", url: "https://stellar.expert/explorer/testnet" },
    ],
    resolutionDeadline: "2026-11-30T00:00:00.000Z",
    timeline: [
      {
        at: "2026-11-18T08:00:00.000Z",
        title: "Outcome submitted",
        description: "Submitter posted a 250 XLM bond for the proposed outcome.",
      },
      {
        at: "2026-11-19T14:45:00.000Z",
        title: "Outcome challenged",
        description: "Challenger posted a 300 XLM bond for the alternative outcome.",
      },
      {
        at: "2026-11-20T10:00:00.000Z",
        title: "Council voting opened",
        description: "Four council members were selected to review the dispute.",
      },
    ],
  },
];
