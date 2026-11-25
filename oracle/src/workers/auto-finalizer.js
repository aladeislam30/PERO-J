import { challengeWindowSeconds } from "../challenge-window.js";
import { invokeMarketContract } from "../market-contract.js";

/** A `finalizing` claim this old belongs to a worker that died mid-call. */
const CLAIM_LEASE = "2 minutes";

// Uncontested, submitted, past deadline. Submissions made by third parties have
// no stored deadline, so theirs derives from when the indexer saw them.
const ELIGIBLE = `
  (
    m.status = 'submitted'
    OR (m.status = 'open' AND m.oracle_state = 'submitted')
    OR (m.status = 'finalizing' AND m.updated_at < NOW() - INTERVAL '${CLAIM_LEASE}')
  )
  AND m.oracle_state NOT IN ('disputed', 'finalized')
  AND NOT EXISTS (
    SELECT 1 FROM oracle_disputes d
    JOIN oracle_submissions ds ON ds.id = d.submission_id
    WHERE ds.market_id = m.id AND ds.status = 'disputed'
  )
  AND COALESCE(
    m.challenge_deadline,
    (
      SELECT s.timestamp + make_interval(secs => $1)
      FROM oracle_submissions s
      WHERE s.market_id = m.id AND s.status = 'pending'
      ORDER BY s.ledger DESC, s.id DESC
      LIMIT 1
    )
  ) < NOW()`;

/**
 * Call the permissionless `finalize_outcome`. The contract owns the escrow: it
 * resolves the market and returns the bond to the submitter in this same call.
 *
 * @param {string} marketId
 */
export async function finalizeOutcomeOnChain(marketId) {
  await invokeMarketContract("finalize_outcome", { market_id: marketId });
}

async function finalizeMarket(db, market, windowSeconds, finalize) {
  const claim = await db.query(
    `UPDATE markets m SET status = 'finalizing', updated_at = NOW()
     WHERE m.id = $2 AND ${ELIGIBLE} RETURNING m.id`,
    [windowSeconds, market.id],
  );
  if (claim.rowCount === 0) {
    return false;
  }
  try {
    await finalize(market.id);
  } catch (err) {
    // `open` (third-party) rows must return to `open`; everything else retries
    // as `submitted`.
    await db.query(
      "UPDATE markets SET status = $2, updated_at = NOW() WHERE id = $1 AND status = 'finalizing'",
      [market.id, market.status === "open" ? "open" : "submitted"],
    );
    throw err;
  }
  // If this write fails the transaction still landed; the lease expires and the
  // indexer's oracle_finalized event reconciles the row.
  await db.query(
    "UPDATE markets SET status = 'resolved', oracle_state = 'finalized', updated_at = NOW() WHERE id = $1",
    [market.id],
  );
  return true;
}

/**
 * Finalize every uncontested submission whose challenge window has closed.
 * One market's failure never blocks the others; it is retried next run.
 *
 * @param {{ query: Function }} db
 * @param {{ finalize?: Function, windowSeconds?: number }} [deps]
 * @returns {Promise<{ finalized: number, failed: number }>}
 */
export async function finalizeUncontestedMarkets(db, deps = {}) {
  const finalize = deps.finalize ?? finalizeOutcomeOnChain;
  const windowSeconds = deps.windowSeconds ?? challengeWindowSeconds();

  // Someone else may have finalized: finalize_outcome is permissionless.
  await db.query(
    `UPDATE markets SET status = 'resolved', updated_at = NOW()
     WHERE oracle_state = 'finalized' AND status IN ('open', 'submitted', 'finalizing')`,
  );

  const { rows } = await db.query(
    `SELECT m.id, m.status FROM markets m WHERE ${ELIGIBLE}
     ORDER BY m.challenge_deadline NULLS LAST, m.id`,
    [windowSeconds],
  );
  const result = { finalized: 0, failed: 0 };
  for (const market of rows) {
    try {
      if (await finalizeMarket(db, market, windowSeconds, finalize)) {
        result.finalized++;
        console.log(`[auto-finalizer] market ${market.id} finalized`);
      }
    } catch (err) {
      result.failed++;
      console.error(`[auto-finalizer] market ${market.id} not finalized: ${err.message}`);
    }
  }
  return result;
}
