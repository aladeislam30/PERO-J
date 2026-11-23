import { Networks } from "@stellar/stellar-sdk";
import type { Market } from "./types";

const network = import.meta.env.VITE_STELLAR_NETWORK === "public" ? "public" : "testnet";

export const marketConfig = {
  contractId: import.meta.env.VITE_MARKET_CONTRACT_ID || "",
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
  networkPassphrase:
    import.meta.env.VITE_NETWORK_PASSPHRASE ||
    (network === "public" ? Networks.PUBLIC : Networks.TESTNET),
  confirmationTimeoutMs: 45_000,
  pollIntervalMs: 1_500,
};

export const markets: Market[] = [
  {
    id: "next_ledger",
    title: "Will the next ledger confirm within 10 seconds?",
    oracleState: "submitted",
    challengeDeadline: import.meta.env.VITE_MARKET_CHALLENGE_DEADLINE || "2026-11-01T00:00:00.000Z",
    challengeBondXlm: 300,
    challengeRewardXlm: 60,
  },
];
