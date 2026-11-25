import { markets as configuredMarkets } from "./config";
import type { Market } from "./types";

const STORAGE_PREFIX = "pero-j:market:";
export const MARKETS_CHANGE_EVENT = "markets-change";

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}${id}`;
}

export function readMarkets(): Market[] {
  const fromStorage = new Map<string, Market>();

  if (typeof localStorage !== "undefined") {
    for (const market of configuredMarkets) {
      try {
        const raw = localStorage.getItem(storageKey(market.id));
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isMarket(parsed)) fromStorage.set(market.id, parsed);
        }
      } catch {
        continue;
      }
    }
  }

  return configuredMarkets.map((market) => fromStorage.get(market.id) ?? market);
}

export function readMarket(id: string): Market | undefined {
  return readMarkets().find((market) => market.id === id);
}

export function recordFinalization(id: string, txHash: string, ledger?: number): void {
  const market = readMarket(id);
  if (!market || typeof localStorage === "undefined") return;

  const updated: Market = {
    ...market,
    oracleState: "finalized",
    finalizedTxHash: txHash,
    finalizedLedger: ledger,
    outcome: market.outcome ?? "Finalized",
  };

  try {
    localStorage.setItem(storageKey(id), JSON.stringify(updated));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(MARKETS_CHANGE_EVENT));
    }
  } catch {
    return;
  }
}

function isMarket(value: unknown): value is Market {
  if (typeof value !== "object" || value === null) return false;
  const market = value as Partial<Market>;
  return (
    typeof market.id === "string" &&
    typeof market.title === "string" &&
    (market.oracleState === "submitted" ||
      market.oracleState === "challenged" ||
      market.oracleState === "finalized") &&
    typeof market.challengeDeadline === "string"
  );
}
