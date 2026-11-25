/**
 * Single-flight request coalescing (issue #1145).
 * Concurrent calls with the same key share one in-flight promise, so a cache
 * miss spike triggers exactly one loader (e.g. one PostgreSQL query).
 */
export class SingleFlight {
  constructor() {
    this.inflight = new Map();
  }

  /**
   * @param {string} key
   * @param {() => Promise<any>} loader invoked only by the first caller
   */
  do(key, loader) {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    let p;
    try {
      p = Promise.resolve(loader());
    } catch (err) {
      p = Promise.reject(err);
    }
    const tracked = p.finally(() => {
      if (this.inflight.get(key) === tracked) this.inflight.delete(key);
    });
    this.inflight.set(key, tracked);
    return tracked;
  }

  get size() {
    return this.inflight.size;
  }
}

export const singleFlight = new SingleFlight();

/**
 * Cache-aside read with stampede protection.
 * @param {{get(k:string):Promise<any>, set(k:string,v:any,ttlMs?:number):Promise<void>}} cache
 */
export async function getOrLoad(cache, key, loader, { ttlMs = 30000, flight = singleFlight } = {}) {
  const hit = await cache.get(key);
  if (hit !== undefined && hit !== null) return hit;
  return flight.do(key, async () => {
    const value = await loader();
    await cache.set(key, value, ttlMs);
    return value;
  });
}
