'use strict';

/**
 * Unified Event Routing Registry (Collapses multiple dispatchers)
 * Dispatches on-chain events to specialized handlers with synchronization.
 */
class EventRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(topic, handler) {
    this.handlers.set(topic, handler);
  }

  async dispatch(event, context) {
    const handler = this.handlers.get(event.topic);
    if (!handler) {
      return { handled: false, topic: event.topic };
    }
    return await handler(event, context);
  }
}

const defaultRegistry = new EventRegistry();
module.exports = { EventRegistry, defaultRegistry };
