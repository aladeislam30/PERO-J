import { useState, useEffect, useRef, useCallback } from "react";
import { streamMarketUpdates, MarketUpdate } from "./api";

/**
 * Custom hook to stream real-time prediction market updates via Server-Sent Events.
 * Eliminates 3-5 second polling delays and conserves network bandwidth on static markets.
 */
export function useMarketStream(contractId?: string) {
  const [latestUpdate, setLatestUpdate] = useState<MarketUpdate | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = streamMarketUpdates(
      contractId,
      (update) => {
        setConnected(true);
        setError(null);
        if (update.type !== "connected") {
          setLatestUpdate(update);
        }
      },
      () => {
        setConnected(false);
        setError("Market stream disconnected. Reconnecting...");
      }
    );

    return () => {
      unsub();
      setConnected(false);
    };
  }, [contractId]);

  return { latestUpdate, connected, error };
}

export type OddsDirection = "up" | "down" | "flat";

export interface MarketBet {
  id?: string;
  outcome?: string;
  amount?: number | string;
  bettor?: string;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface MarketPoolBalances {
  [outcome: string]: number;
}

export interface MarketLiveState {
  odds: Record<string, number>;
  pools: MarketPoolBalances;
  recentBets: MarketBet[];
  oddsDirection: OddsDirection;
  connected: boolean;
  error: string | null;
}

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_RECENT_BETS = 50;

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractOdds(update: MarketUpdate): Record<string, number> | null {
  const raw = (update as Record<string, unknown>).odds;
  if (!raw || typeof raw !== "object") return null;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const num = toNumber(value);
    if (num !== null) result[key] = num;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function extractPools(update: MarketUpdate): MarketPoolBalances | null {
  const raw =
    (update as Record<string, unknown>).pools ??
    (update as Record<string, unknown>).poolBalances ??
    (update as Record<string, unknown>).pool;
  if (!raw || typeof raw !== "object") return null;
  const result: MarketPoolBalances = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const num = toNumber(value);
    if (num !== null) result[key] = num;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function extractBet(update: MarketUpdate): MarketBet | null {
  const raw =
    (update as Record<string, unknown>).bet ??
    (update as Record<string, unknown>).data;
  if (!raw || typeof raw !== "object") return null;
  return raw as MarketBet;
}

/**
 * Live market updates hook backed by Server-Sent Events.
 *
 * Streams incoming bets, pool balance shifts, and odds changes directly into
 * React state, reconnecting with exponential backoff (1s, 2s, 4s ... capped at
 * 30s) if the connection drops. Exposes `oddsDirection` so the UI can animate
 * odds changes (green for increases, red for decreases).
 */
export function useMarketLiveUpdates(marketId?: string) {
  const [odds, setOdds] = useState<Record<string, number>>({});
  const [pools, setPools] = useState<MarketPoolBalances>({});
  const [recentBets, setRecentBets] = useState<MarketBet[]>([]);
  const [oddsDirection, setOddsDirection] = useState<OddsDirection>("flat");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oddsRef = useRef<Record<string, number>>({});
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unmountedRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const handleUpdate = useCallback((update: MarketUpdate) => {
    if (update.type === "connected") {
      setConnected(true);
      setError(null);
      return;
    }

    setConnected(true);
    setError(null);

    const nextOdds = extractOdds(update);
    if (nextOdds) {
      const prevOdds = oddsRef.current;
      let direction: OddsDirection = "flat";
      for (const [key, value] of Object.entries(nextOdds)) {
        const prev = prevOdds[key];
        if (prev === undefined) continue;
        if (value > prev) {
          direction = "up";
          break;
        }
        if (value < prev) {
          direction = "down";
          break;
        }
      }
      oddsRef.current = { ...prevOdds, ...nextOdds };
      setOdds(oddsRef.current);
      setOddsDirection(direction);
    }

    const nextPools = extractPools(update);
    if (nextPools) {
      setPools((prev) => ({ ...prev, ...nextPools }));
    }

    const bet = extractBet(update);
    if (bet) {
      setRecentBets((prev) => [bet, ...prev].slice(0, MAX_RECENT_BETS));
    }
  }, []);

  useEffect(() => {
    if (!marketId) {
      setConnected(false);
      setError(null);
      return;
    }

    unmountedRef.current = false;
    reconnectAttemptRef.current = 0;

    const connect = () => {
      if (unmountedRef.current) return;

      clearReconnectTimer();

      const unsub = streamMarketUpdates(
        marketId,
        (update) => {
          if (unmountedRef.current) return;
          reconnectAttemptRef.current = 0;
          handleUpdate(update);
        },
        () => {
          if (unmountedRef.current) return;
          setConnected(false);
          setError("Market stream disconnected. Reconnecting...");

          const attempt = reconnectAttemptRef.current;
          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(2, attempt),
            MAX_RECONNECT_DELAY
          );
          reconnectAttemptRef.current = attempt + 1;

          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (unmountedRef.current) return;
            if (unsubRef.current) {
              unsubRef.current();
              unsubRef.current = null;
            }
            connect();
          }, delay);
        }
      );

      unsubRef.current = unsub;
    };

    connect();

    return () => {
      unmountedRef.current = true;
      clearReconnectTimer();
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      setConnected(false);
    };
  }, [marketId, handleUpdate, clearReconnectTimer]);

  return {
    odds,
    pools,
    recentBets,
    oddsDirection,
    connected,
    error,
  };
}