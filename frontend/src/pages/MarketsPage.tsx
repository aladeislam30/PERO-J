import { Link } from "react-router-dom";
import { useMarkets } from "../hooks/useMarkets";

export default function MarketsPage() {
  const markets = useMarkets();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="card">
        <h2 style={{ marginBottom: 8 }}>Markets</h2>
        <p style={{ color: "var(--muted)" }}>
          Open a market to follow its oracle state and finalize the outcome once the challenge window closes.
        </p>
      </section>

      <section className="card">
        {markets.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No markets are available.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {markets.map((market) => (
              <Link
                key={market.id}
                to={`/market/${market.id}`}
                style={{ color: "inherit", textDecoration: "none", display: "block" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{market.title}</span>
                  <span className={`badge ${market.oracleState === "finalized" ? "green" : "yellow"}`}>
                    {market.oracleState}
                  </span>
                </div>
                <code style={{ fontSize: 11, color: "var(--muted)" }}>{market.id}</code>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
