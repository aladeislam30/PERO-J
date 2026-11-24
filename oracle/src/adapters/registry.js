import { BaseAdapter } from "./base.js";

/**
 * Maps markets to the adapters that must agree on their outcome. The first
 * matching slug route wins; category routes are the fallback. Slug patterns
 * are exact, or prefixes when they end in `*`.
 */
export class AdapterRegistry {
  #adapters = new Map();
  #slugRoutes = [];
  #categoryRoutes = new Map();

  register(adapter) {
    if (!(adapter instanceof BaseAdapter)) {
      throw new TypeError("Adapters must extend BaseAdapter");
    }
    if (this.#adapters.has(adapter.name)) {
      throw new Error(`Adapter "${adapter.name}" is already registered`);
    }
    this.#adapters.set(adapter.name, adapter);
    return this;
  }

  routeSlug(pattern, names) {
    this.#assertNames(names);
    this.#slugRoutes.push({ pattern, names: [...names] });
    return this;
  }

  routeCategory(category, names) {
    this.#assertNames(names);
    this.#categoryRoutes.set(category, [...names]);
    return this;
  }

  get(name) {
    return this.#adapters.get(name);
  }

  /**
   * @param {{ slug?: string, category?: string }} market
   * @returns {BaseAdapter[]}
   */
  resolve({ slug, category }) {
    const route =
      typeof slug === "string" &&
      this.#slugRoutes.find(({ pattern }) =>
        pattern.endsWith("*") ? slug.startsWith(pattern.slice(0, -1)) : slug === pattern,
      );
    const names = route ? route.names : this.#categoryRoutes.get(category);
    if (!names) {
      throw new Error(`no adapters configured for slug "${slug}" or category "${category}"`);
    }
    return names.map((name) => this.#adapters.get(name));
  }

  #assertNames(names) {
    if (!Array.isArray(names) || names.length === 0) {
      throw new TypeError("A route needs at least one adapter");
    }
    for (const name of names) {
      if (!this.#adapters.has(name)) {
        throw new Error(`Adapter "${name}" is not registered`);
      }
    }
  }
}
