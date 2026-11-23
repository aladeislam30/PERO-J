export type OracleState = "submitted" | "challenged" | "finalized";

export interface Market {
  id: string;
  title: string;
  oracleState: OracleState;
  challengeDeadline: string;
  challengeBondXlm?: number;
  challengeRewardXlm?: number;
  outcome?: string;
  finalizedTxHash?: string;
  finalizedLedger?: number;
}

export interface FinalizeResult {
  txHash: string;
  ledger?: number;
}
