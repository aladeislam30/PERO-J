import { AdapterDataError, BaseAdapter } from "./base.js";
import { createPoliticsAdapter } from "./politics.js";
import { createScienceWeatherAdapter } from "./science-weather.js";

/** Convert a pending/resolved result into the boolean adapter contract. */
function toOutcome(name, result) {
  if (result.status !== "resolved") {
    throw new AdapterDataError(`${name}: outcome pending (${result.reason})`);
  }
  return result.outcome;
}

export class PoliticsAdapter extends BaseAdapter {
  #source;

  constructor({ endpoint, apiKey, ...options }) {
    super({ name: "politics", rateLimit: { capacity: 2, refillPerSecond: 1 }, ...options });
    this.#source = createPoliticsAdapter({ endpoint, apiKey, fetchImpl: this.fetch });
  }

  async resolve(params) {
    return toOutcome(this.name, await this.#source.resolve(params));
  }
}

export class ScienceWeatherAdapter extends BaseAdapter {
  #source;

  constructor({ noaaEndpoint, noaaToken, launchEndpoint, ...options } = {}) {
    // NOAA CDO allows five requests per second per token.
    super({ name: "science-weather", rateLimit: { capacity: 5, refillPerSecond: 5 }, ...options });
    this.#source = createScienceWeatherAdapter({
      noaaEndpoint,
      noaaToken,
      launchEndpoint,
      fetchImpl: this.fetch,
    });
  }

  async resolve(params) {
    const result = params?.launchId
      ? await this.#source.resolveLaunch(params)
      : await this.#source.resolveWeather(params ?? {});
    return toOutcome(this.name, result);
  }
}
