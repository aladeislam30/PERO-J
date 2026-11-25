import { BaseAdapter, parsePrice, priceOutcome } from "./base.js";
import { requireString } from "./http.js";

export class BinanceAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ name: "binance", rateLimit: { capacity: 10, refillPerSecond: 10 }, ...options });
  }

  async resolve(params) {
    const symbol = requireString(params?.symbol, "symbol");
    const data = await this.getJson(
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    );
    return priceOutcome(parsePrice(data?.price, this.name), params);
  }
}
