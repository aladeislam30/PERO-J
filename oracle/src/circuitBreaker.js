'use strict';

/**
 * Circuit breaker stopping auto-submissions after consecutive challenge losses
 */
class CircuitBreaker {
  constructor(maxLosses = 3, cooldownMs = 3600000) {
    this.maxLosses = maxLosses;
    this.cooldownMs = cooldownMs;
    this.consecutiveLosses = 0;
    this.trippedAt = null;
  }

  recordLoss() {
    this.consecutiveLosses += 1;
    if (this.consecutiveLosses >= this.maxLosses) {
      this.trippedAt = Date.now();
    }
  }

  recordSuccess() {
    this.consecutiveLosses = 0;
    this.trippedAt = null;
  }

  isOpen() {
    if (!this.trippedAt) return false;
    if (Date.now() - this.trippedAt > this.cooldownMs) {
      this.consecutiveLosses = 0;
      this.trippedAt = null;
      return false;
    }
    return true;
  }
}

module.exports = { CircuitBreaker };
