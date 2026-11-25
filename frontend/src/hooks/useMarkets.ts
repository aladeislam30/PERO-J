import { useEffect, useState } from "react";
import { MARKETS_CHANGE_EVENT, readMarket, readMarkets } from "../markets/storage";
import type { Market } from "../markets/types";

const REFRESH_INTERVAL_MS = 15_000;

export function useMarkets(): Market[] {
  const [markets, setMarkets] = useState<Market[]>(() => readMarkets());

  useEffect(() => {
    const refresh = () => setMarkets(readMarkets());
    refresh();

    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("storage", refresh);
    window.addEventListener(MARKETS_CHANGE_EVENT, refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(MARKETS_CHANGE_EVENT, refresh);
    };
  }, []);

  return markets;
}

export function useMarket(id: string): Market | undefined {
  const markets = useMarkets();
  return id ? readMarket(id) ?? markets.find((market) => market.id === id) : undefined;
}
