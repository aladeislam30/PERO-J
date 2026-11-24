'use strict';

/**
 * Distributed single-writer advisory lock using PostgreSQL pg_try_advisory_lock
 */
async function acquireIndexerLock(db, lockId = 948271) {
  const res = await db.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockId]);
  return Boolean(res.rows[0] && res.rows[0].acquired);
}

async function releaseIndexerLock(db, lockId = 948271) {
  await db.query('SELECT pg_advisory_unlock($1)', [lockId]);
}

module.exports = { acquireIndexerLock, releaseIndexerLock };
