import { nativeToScVal } from "@stellar/stellar-sdk";
import { invokeContract } from "./soroban";
import type { FinalizeResult } from "./types";

export interface ChallengeGateway {
  challengeOutcome(marketId: string, bondXlm: number): Promise<FinalizeResult>;
}

export class SorobanChallengeGateway implements ChallengeGateway {
  async challengeOutcome(marketId: string, bondXlm: number): Promise<FinalizeResult> {
    const stroops = BigInt(Math.round(bondXlm * 10_000_000)).toString();
    return invokeContract("challenge_outcome", [
      nativeToScVal(marketId, { type: "symbol" }),
      nativeToScVal(stroops, { type: "i128" }),
    ]);
  }
}
