'use strict';

/**
 * N-of-M Multi-Source Agreement Gate
 * Requires minimum quorum and agreement percentage across independent oracle adapters.
 */
function evaluateConsensus(results, requiredQuorum = 3, thresholdPct = 0.66) {
  if (!results || results.length < requiredQuorum) {
    return { agreed: false, reason: 'QUORUM_NOT_MET' };
  }
  const counts = {};
  for (const r of results) {
    counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  }
  for (const [outcome, count] of Object.entries(counts)) {
    if (count / results.length >= thresholdPct) {
      return { agreed: true, outcome, confidence: count / results.length };
    }
  }
  return { agreed: false, reason: 'NO_MAJORITY_CONSENSUS' };
}

module.exports = { evaluateConsensus };
