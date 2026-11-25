'use strict';

/**
 * Standalone Scheduler Daemon for Automated Market Monitoring & Resolution
 */
class MarketScheduler {
  constructor(pollIntervalMs = 15000) {
    this.pollIntervalMs = pollIntervalMs;
    this.running = false;
  }

  start(task) {
    this.running = true;
    this.timer = setInterval(async () => {
      try {
        await task();
      } catch (err) {
        console.error('[MarketScheduler] Task execution error:', err);
      }
    }, this.pollIntervalMs);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = { MarketScheduler };
