'use strict';

/**
 * Auto-Challenge Worker: validates third-party submissions against verified adapters
 */
async function inspectAndChallenge(market, thirdPartySubmission, verifiedResult) {
  if (thirdPartySubmission.outcome !== verifiedResult.outcome) {
    return {
      action: 'CHALLENGE',
      marketId: market.id,
      expected: verifiedResult.outcome,
      submitted: thirdPartySubmission.outcome
    };
  }
  return { action: 'PASS' };
}

module.exports = { inspectAndChallenge };
