export type CouncilSide = "submitter" | "challenger";

export interface CouncilVote {
  voter: string;
  side: CouncilSide;
  votedAt: string;
}

export interface EvidenceLink {
  label: string;
  url: string;
}

export interface DisputeTimelineEvent {
  at: string;
  title: string;
  description?: string;
}

export interface Dispute {
  marketId: string;
  marketTitle: string;
  submitterAddress: string;
  proposedOutcome: string;
  submitterBondXlm: number;
  submitterTxHash: string;
  challengerAddress: string;
  disputedOutcome: string;
  challengerBondXlm: number;
  challengerTxHash: string;
  councilSize: number;
  votes: CouncilVote[];
  evidenceLinks: EvidenceLink[];
  resolutionDeadline: string;
  timeline: DisputeTimelineEvent[];
}
