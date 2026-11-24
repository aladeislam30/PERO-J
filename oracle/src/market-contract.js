import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INVOKE_TIMEOUT_MS = 60_000;

let queue = Promise.resolve();

/**
 * Invoke the market contract with the oracle worker key. Calls are serialized:
 * concurrent transactions from one account would collide on sequence number.
 *
 * @param {string} fn
 * @param {Record<string, string>} args
 * @param {typeof execFileAsync} [exec]
 * @returns {Promise<unknown>}
 */
export function invokeMarketContract(fn, args, exec = execFileAsync) {
  const run = queue.then(() => invoke(fn, args, exec));
  queue = run.catch(() => {});
  return run;
}

async function invoke(fn, args, exec) {
  const contractId = process.env.PERO_MARKET_CONTRACT_ID;
  const secret = process.env.ORACLE_HOT_WALLET_SECRET;
  if (!contractId || !secret) {
    throw new Error("PERO_MARKET_CONTRACT_ID and ORACLE_HOT_WALLET_SECRET are required");
  }
  try {
    return await exec(
      "soroban",
      [
        "contract",
        "invoke",
        "--id",
        contractId,
        "--source",
        secret,
        "--rpc-url",
        process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
        "--network-passphrase",
        process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
        "--",
        fn,
        ...Object.entries(args).flatMap(([name, value]) => [`--${name}`, value]),
      ],
      { timeout: INVOKE_TIMEOUT_MS },
    );
  } catch (err) {
    // execFile errors embed the full command line, including the secret key.
    const detail = String(err.stderr || err.code || "invocation failed")
      .replaceAll(secret, "[redacted]")
      .trim();
    throw new Error(`${fn} failed: ${detail}`);
  }
}
