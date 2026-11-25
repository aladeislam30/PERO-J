'use strict';

/**
 * Full jitter randomized backoff for Soroban RPC calls (Decorrelated Jitter)
 */
function calculateJitterBackoff(attempt, baseMs = 100, maxMs = 10000) {
  const temp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  return Math.floor(Math.random() * temp);
}

module.exports = { calculateJitterBackoff };
