import { registry } from "../adapters/index.js";
import { challengeWindowSeconds } from "../challenge-window.js";
import { invokeMarketContract } from "../market-contract.js";

/**
 * Query every adapter the registry maps to the market and require unanimous
 * agreement. Any adapter failure or disagreement throws, aborting submission.
 *
 * @param {{ id: string, slug?: string, category?: string, params: object }} market
 * @param {{ resolve: Function }} [adapters]
 * @returns {Promise<boolean>}
 */
export async function determineOutcome(market, adapters = registry) {
  const outcomes = await Promise.all(
    adapters.resolve(market).map((adapter) => adapter.resolve(market.params)),
  );
  if (outcomes.some((outcome) => typeof outcome !== "boolean")) {
    throw new Error(`adapter returned a non-boolean outcome for market ${market.id}`);
  }
  if (new Set(outcomes).size !== 1) {
    throw new Error(
      `adapters disagree for market ${market.id}: ${outcomes.join(",")}`,
    );
  }
  return outcomes[0];
}

/**
 * Call Soroban `submit_outcome` using the protocol hot wallet, attaching the
 * configured submitter bond.
 *
 * @param {string} marketId
 * @param {boolean} outcome
 */
export async function submitOutcomeOnChain(marketId, outcome) {
  await invokeMarketContract("submit_outcome", {
    market_id: marketId,
    outcome: String(outcome),
    bond: String(process.env.ORACLE_BOND_AMOUNT),
  });
}

/**
 * Claim an expired open market, determine its outcome, and submit it on-chain.
 * The market is released back to `open` on any failure so it is retried on the
 * next poll; nothing is submitted when external data cannot be fetched.
 *
 * @param {{ query: Function }} db
 * @param {{ id: string, slug?: string, category?: string, params: object }} market
 * @param {{ determine?: Function, submit?: Function, canResolve?: () => Promise<boolean> }} [deps]
 * @returns {Promise<boolean>} true when an outcome was submitted
 */
export async function submitExpiredMarket(db, market, deps = {}) {
  const determine = deps.determine ?? determineOutcome;
  const submit = deps.submit ?? submitOutcomeOnChain;
  const canResolve = deps.canResolve ?? (async () => true);

  const claim = await db.query(
    "UPDATE markets SET status = 'submitting' WHERE id = $1 AND status = 'open' RETURNING id",
    [market.id],
  );
  if (claim.rowCount === 0) {
    return false;
  }

  try {
    const outcome = await determine(market);
    // Re-checked here because fetching the outcome can take several seconds.
    if (!(await canResolve())) {
      throw new Error("automated resolution halted by bond escrow audit");
    }
    await submit(market.id, outcome);
    await db.query(
      "UPDATE markets SET status = 'submitted', challenge_deadline = NOW() + make_interval(secs => $2) WHERE id = $1",
      [market.id, challengeWindowSeconds()],
    );
    return true;
  } catch (err) {
    await db.query("UPDATE markets SET status = 'open' WHERE id = $1", [
      market.id,
    ]);
    console.error(
      `[auto-submitter] market ${market.id} not submitted: ${err.message}`,
    );
    return false;
  }
}
