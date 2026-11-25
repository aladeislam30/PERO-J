import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useBets } from "../bets/BetsContext";
import BetRow from "../bets/BetRow";
import BetSlip from "../bets/BetSlip";
import { useMarketLiveUpdates } from "../hooks/useMarketLiveUpdates";

type OddsDirection = "up" | "down" | "flat";

const oddsTransitionStyle: React.CSSProperties = {
  transition: "color 400ms ease, background-color 400ms ease",
};

export default function BettingPage() {
  const { address, pendingBets } = useBets();
  const params = useParams<{ marketId?: string }>();
  const marketId = params.marketId ?? "";

  const { odds, poolBalance, status, lastEventAt } = useMarketLiveUpdates(marketId);

  const prevOddsRef = useRef<number | null>(null);
  const [oddsDirection, setOddsDirection] = useState<OddsDirection>("flat");
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    document.title = "Place a Bet - Soroban Smart Block Explorer";
  }, []);

  useEffect(() => {
    if (odds == null) return;
    const prev = prevOddsRef.current;
    if (prev == null) {
      prevOddsRef.current = odds;
      return;
    }
    if (odds === prev) return;
    setOddsDirection(odds > prev ? "up" : "down");
    setHighlight(true);
    prevOddsRef.current = odds;
    const timer = window.setTimeout(() => {
      setHighlight(false);
      setOddsDirection("flat");
    }, 800);
    return () => window.clearTimeout(timer);
  }, [odds]);

  const oddsColor = useMemo(() => {
    if (oddsDirection === "up") return "var(--success, #16a34a)";
    if (oddsDirection === "down") return "var(--danger, #dc2626)";
    return undefined;
  }, [oddsDirection]);

  const oddsBackground = useMemo(() => {
    if (!highlight) return undefined;
    if (oddsDirection === "up") return "rgba(22, 163, 74, 0.12)";
    if (oddsDirection === "down") return "rgba(220, 38, 38, 0.12)";
    return undefined;
  }, [highlight, oddsDirection]);

  const myBets = address ? pendingBets.filter((b) => b.address === address) : [];

  const isDisconnected = status === "disconnected" || status === "reconnecting";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Place a Bet</h1>
        <p style={{ color: "var(--muted)" }}>
          Sign a bet transaction and watch it update instantly — it is reconciled against the
          indexer once the transaction lands on-chain.
        </p>
      </div>

      {isDisconnected && (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 12,
            color: "var(--muted)",
            background: "rgba(148, 163, 184, 0.15)",
            transition: "opacity 300ms ease",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: status === "reconnecting" ? "#f59e0b" : "#94a3b8",
            }}
          />
          {status === "reconnecting" ? "Reconnecting to live updates…" : "Live updates disconnected"}
        </div>
      )}

      <div className="card" style={{ display: "flex", gap: 24, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Live odds</div>
          <div
            style={{
              ...oddsTransitionStyle,
              fontSize: 24,
              fontWeight: 600,
              color: oddsColor,
              background: oddsBackground,
              borderRadius: 6,
              padding: "2px 8px",
              display: "inline-block",
            }}
          >
            {odds == null ? "—" : odds.toFixed(2)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Pool balance</div>
          <div style={{ ...oddsTransitionStyle, fontSize: 24, fontWeight: 600 }}>
            {poolBalance == null ? "—" : poolBalance.toLocaleString()}
          </div>
        </div>
        {lastEventAt != null && (
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            Updated {new Date(lastEventAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      <BetSlip />

      <div className="card">
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Your bets</h2>
        {myBets.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            Bets you place appear here instantly, before ledger confirmation.
          </p>
        ) : (
          <div>
            {myBets.map((bet) => (
              <BetRow key={bet.id} bet={bet} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}