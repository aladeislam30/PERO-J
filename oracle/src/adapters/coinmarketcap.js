import { BaseAdapter, parsePrice, priceOutcome } from "./base.js";
import { requireString } from "./http.js";

export class CoinMarketCapAdapter extends BaseAdapter {
  constructor({ apiKey, ...options } = {}) {
    // 30 requests/minute, the lowest CoinMarketCap plan limit.
    super({ name: "coinmarketcap", rateLimit: { capacity: 5, refillPerSecond: 0.5 }, ...options });
    this.apiKey = apiKey;
  }

  async resolve(params) {
    const symbol = requireString(params?.cmc_symbol, "cmc_symbol");
    const data = await this.getJson(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}`,
      { headers: { "X-CMC_PRO_API_KEY": this.apiKey ?? process.env.COINMARKETCAP_API_KEY ?? "" } },
    );
    const entry = data?.data?.[symbol];
    const price = (Array.isArray(entry) ? entry[0] : entry)?.quote?.USD?.price;
    return priceOutcome(parsePrice(price, this.name), params);
  }
}
