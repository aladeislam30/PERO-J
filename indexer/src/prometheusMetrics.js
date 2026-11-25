'use strict';

/**
 * Prometheus metrics registry for indexer ledger lag, processed events, and errors
 */
const metrics = {
  ledgerLag: 0,
  processedEventsTotal: 0,
  eventErrorsTotal: 0,
  recordLag(lag) { this.ledgerLag = lag; },
  incEvents(count = 1) { this.processedEventsTotal += count; },
  incErrors(count = 1) { this.eventErrorsTotal += count; },
  renderPrometheus() {
    return [
      '# HELP indexer_ledger_lag Current lag in ledgers behind blockchain tip',
      '# TYPE indexer_ledger_lag gauge',
      `indexer_ledger_lag ${this.ledgerLag}`,
      '# HELP indexer_processed_events_total Total ledger events successfully indexed',
      '# TYPE indexer_processed_events_total counter',
      `indexer_processed_events_total ${this.processedEventsTotal}`,
      '# HELP indexer_errors_total Total errors encountered during indexing',
      '# TYPE indexer_errors_total counter',
      `indexer_errors_total ${this.eventErrorsTotal}`
    ].join('\n');
  }
};

module.exports = { metrics };
