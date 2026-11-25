'use strict';

/**
 * Publish indexed ledger events to Redis pub/sub channel for downstream services
 */
async function publishLedgerEvent(redisClient, channel, event) {
  if (!redisClient) return;
  const payload = JSON.stringify({
    topic: event.topic,
    contract: event.contract,
    ledger: event.ledger,
    data: event.data,
    publishedAt: new Date().toISOString()
  });
  await redisClient.publish(channel, payload);
}

module.exports = { publishLedgerEvent };
