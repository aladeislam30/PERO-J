'use strict';

/**
 * Persist immutable resolution audit records with raw source payloads for disputes
 */
async function recordResolutionAudit(db, marketId, outcome, rawPayload, adapterId) {
  await db.query(
    `INSERT INTO resolution_audit_records (market_id, outcome, raw_payload, adapter_id, recorded_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [marketId, outcome, JSON.stringify(rawPayload), adapterId]
  );
}

module.exports = { recordResolutionAudit };
