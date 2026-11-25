import { BinanceAdapter } from "./binance.js";
import { CoinMarketCapAdapter } from "./coinmarketcap.js";
import { PoliticsAdapter, ScienceWeatherAdapter } from "./factory.js";
import { AdapterRegistry } from "./registry.js";
import { TheOddsApiAdapter } from "./the-odds-api.js";

/** Registry with every built-in provider; `options` apply to each adapter. */
export function createDefaultRegistry(options = {}, env = process.env) {
  const registry = new AdapterRegistry()
    .register(new BinanceAdapter(options))
    .register(new CoinMarketCapAdapter(options))
    .register(new TheOddsApiAdapter(options))
    .register(new ScienceWeatherAdapter({ ...options, noaaToken: env.NOAA_API_TOKEN }))
    .routeSlug("crypto-*", ["binance", "coinmarketcap"])
    .routeSlug("sports-*", ["oddsapi"])
    .routeSlug("science-*", ["science-weather"])
    .routeSlug("weather-*", ["science-weather"])
    .routeCategory("crypto", ["binance", "coinmarketcap"])
    .routeCategory("sports", ["oddsapi"])
    .routeCategory("science", ["science-weather"])
    .routeCategory("weather", ["science-weather"]);

  // There is no public default election feed, so one must be configured.
  if (env.POLITICS_FEED_URL) {
    registry
      .register(
        new PoliticsAdapter({
          ...options,
          endpoint: env.POLITICS_FEED_URL,
          apiKey: env.POLITICS_FEED_API_KEY,
        }),
      )
      .routeSlug("politics-*", ["politics"])
      .routeCategory("politics", ["politics"]);
  }
  return registry;
}

export const registry = createDefaultRegistry();
