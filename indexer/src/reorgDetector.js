'use strict';

/**
 * Blockchain reorg detector and ledger replay state manager
 */
class ReorgDetector {
  constructor(maxDepth = 64) {
    this.maxDepth = maxDepth;
    this.history = [];
  }

  record(ledgerSequence, hash) {
    this.history.push({ sequence: ledgerSequence, hash });
    if (this.history.length > this.maxDepth) {
      this.history.shift();
    }
  }

  detectReorg(incomingSequence, incomingPreviousHash) {
    const parent = this.history.find(item => item.sequence === incomingSequence - 1);
    if (!parent) return false;
    return parent.hash !== incomingPreviousHash;
  }
}

module.exports = { ReorgDetector };
