import { Contract, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { marketConfig } from "./config";
import type { FinalizeResult } from "./types";

interface FreighterAPI {
  isConnected(): Promise<boolean>;
  connect(): Promise<{ address: string }>;
  getAddress(): Promise<{ address: string }>;
  signTransaction(
    xdr: string,
    options: { networkPassphrase: string }
  ): Promise<{ signedTransaction: string }>;
}

declare global {
  interface Window {
    freighter?: FreighterAPI;
  }
}

export interface FinalizeGateway {
  finalizeOutcome(marketId: string): Promise<FinalizeResult>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getServer(): rpc.Server {
  return new rpc.Server(marketConfig.rpcUrl, {
    allowHttp: marketConfig.rpcUrl.startsWith("http://"),
  });
}

export class SorobanFinalizeGateway implements FinalizeGateway {
  async finalizeOutcome(marketId: string): Promise<FinalizeResult> {
    if (!marketConfig.contractId) {
      throw new Error("Market contract is not configured. Set VITE_MARKET_CONTRACT_ID.");
    }
    if (!window.freighter) {
      throw new Error("Freighter wallet is not installed.");
    }

    const address = await this.connect();
    const server = getServer();
    const account = await server.getAccount(address);
    const contract = new Contract(marketConfig.contractId);

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: marketConfig.networkPassphrase,
    })
      .addOperation(contract.call("finalize_outcome", nativeToScVal(marketId, { type: "symbol" })))
      .setTimeout(60)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(simulation.error || "Finalize transaction simulation failed.");
    }

    const prepared = rpc.assembleTransaction(tx, simulation).build();
    const { signedTransaction } = await window.freighter.signTransaction(prepared.toXDR(), {
      networkPassphrase: marketConfig.networkPassphrase,
    });
    const signedTx = TransactionBuilder.fromXDR(signedTransaction, marketConfig.networkPassphrase);
    const result = await server.sendTransaction(signedTx);

    if (result.status === "ERROR") {
      throw new Error("The network rejected the finalization transaction.");
    }
    if (result.status === "TRY_AGAIN_LATER") {
      throw new Error("The network is busy. Try finalizing again.");
    }

    const deadline = Date.now() + marketConfig.confirmationTimeoutMs;
    while (Date.now() < deadline) {
      const confirmation = await server.getTransaction(result.hash);
      if (confirmation.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error("Finalization failed on-chain.");
      }
      if (confirmation.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { txHash: result.hash, ledger: confirmation.ledger };
      }
      await delay(marketConfig.pollIntervalMs);
    }

    throw new Error("Timed out waiting for finalization confirmation.");
  }

  private async connect(): Promise<string> {
    const freighter = window.freighter!;
    if (!(await freighter.isConnected())) {
      await freighter.connect();
    }
    const { address } = await freighter.getAddress();
    return address;
  }
}
