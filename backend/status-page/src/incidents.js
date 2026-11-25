'use strict';

/**
 * Historical incident post-mortem log for the public status page.
 *
 * Each entry documents a past incident affecting one or more monitored
 * components. Entries are rendered newest-first on `/status`.
 *
 * Shape:
 *   id          - stable slug used for anchors / links
 *   title       - short human-readable summary
 *   severity    - 'minor' | 'major' | 'critical'
 *   status      - 'resolved' | 'monitoring'
 *   components  - component ids (see components.js)
 *   startedAt   - ISO timestamp when impact began
 *   resolvedAt  - ISO timestamp when impact ended (null if ongoing)
 *   summary     - what users experienced
 *   rootCause   - post-mortem root cause
 *   resolution  - remediation performed
 */

const INCIDENTS = [
  {
    id: '2024-11-14-horizon-ingestion-lag',
    title: 'Horizon ingestion lag delayed balance updates',
    severity: 'major',
    status: 'resolved',
    components: ['stellar-horizon', 'chain-indexer'],
    startedAt: '2024-11-14T09:12:00Z',
    resolvedAt: '2024-11-14T10:41:00Z',
    summary:
      'Balance and transaction history updates were delayed by up to 25 minutes while Horizon ingestion fell behind the network ledger tip.',
    rootCause:
      'A burst of high-throughput contract events saturated the ingestion worker pool, causing the ledger cursor to fall behind.',
    resolution:
      'Scaled ingestion workers horizontally and added backpressure limits on the event queue. Cursor caught up within 30 minutes.',
  },
  {
    id: '2024-10-02-rpc-degradation',
    title: 'Elevated RPC latency and intermittent timeouts',
    severity: 'minor',
    status: 'resolved',
    components: ['stellar-rpc', 'backend-api'],
    startedAt: '2024-10-02T18:03:00Z',
    resolvedAt: '2024-10-02T18:52:00Z',
    summary:
      'A subset of RPC requests timed out and REST API calls that depend on simulation returned 503s.',
    rootCause:
      'Upstream RPC provider experienced regional network degradation, increasing p99 latency beyond client timeouts.',
    resolution:
      'Failed over to a secondary RPC provider and tuned client retry/backoff. Primary provider confirmed recovery.',
  },
  {
    id: '2024-08-21-oracle-resolver-stall',
    title: 'Optimistic oracle resolutions stalled',
    severity: 'major',
    status: 'resolved',
    components: ['oracle-resolvers'],
    startedAt: '2024-08-21T13:27:00Z',
    resolvedAt: '2024-08-21T15:05:00Z',
    summary:
      'Optimistic oracle requests were not being resolved within the expected dispute window.',
    rootCause:
      'A resolver worker crashed on an unhandled edge case in settlement parsing and was not restarted automatically.',
    resolution:
      'Restarted the resolver workers, patched the parsing edge case, and added a liveness probe to auto-restart stalled workers.',
  },
];

function getIncidents() {
  return INCIDENTS.slice().sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
  );
}

function getIncidentById(id) {
  return INCIDENTS.find((incident) => incident.id === id) || null;
}

module.exports = { getIncidents, getIncidentById };
