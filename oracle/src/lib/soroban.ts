import {
  Account,
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";

// Reads are simulated, never signed, so any valid account works as the source.
const DEFAULT_SOURCE =
  "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";

const RPC_TIMEOUT_MS = 20_000;

async function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${RPC_TIMEOUT_MS}ms`)),
      RPC_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Read a contract value by simulating a call; nothing is submitted. */
export async function simulateRead(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<unknown> {
  const rpcUrl =
    process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
  const rpc = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const tx = new TransactionBuilder(
    new Account(process.env.OPERATIONAL_ACCOUNT || DEFAULT_SOURCE, "0"),
    {
      fee: "100",
      networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.TESTNET,
    },
  )
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await withTimeout(rpc.simulateTransaction(tx), method);
  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`${method} simulation failed: ${result.error}`);
  }
  const retval = result.result?.retval;
  if (!retval) {
    throw new Error(`${method} simulation returned no value`);
  }
  return scValToNative(retval);
}
