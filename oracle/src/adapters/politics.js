'use strict';

/**
 * External API Adapter for Politics and Elections category
 */
class PoliticsAdapter {
  constructor(apiClient) {
    this.client = apiClient;
    this.category = 'politics';
  }

  async fetchOutcome(marketSlug) {
    const data = await this.client.get(`/elections/${marketSlug}`);
    return {
      source: 'politics-adapter',
      outcome: data.winner,
      timestamp: Date.now(),
      stale: false
    };
  }
}

module.exports = { PoliticsAdapter };
