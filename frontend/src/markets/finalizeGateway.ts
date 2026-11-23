import { nativeToScVal } from "@stellar/stellar-sdk";
import { invokeContract } from "./soroban";
import type { FinalizeResult } from "./types";

export interface FinalizeGateway {
  finalizeOutcome(marketId: string): Promise<FinalizeResult>;
}

export class SorobanFinalizeGateway implements FinalizeGateway {
  async finalizeOutcome(marketId: string): Promise<FinalizeResult> {
    return invokeContract("finalize_outcome", [nativeToScVal(marketId, { type: "symbol" })]);
  }
}
