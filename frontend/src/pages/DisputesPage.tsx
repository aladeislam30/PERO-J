import { Link } from "react-router-dom";
import { useDisputes } from "../hooks/useDisputes";

export default function DisputesPage() {
  const disputes = useDisputes();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="card">
        <h2 style={{ marginBottom: 8 }}>Disputes</h2>
        <p style={{ color: "var(--muted)" }}>
          Follow council votes, posted bonds and audit evidence for every disputed market outcome.
        </p>
      </section>

      <section className="card">
        {disputes.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No disputes are available.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {disputes.map((dispute) => (
              <Link
                key={dispute.marketId}
                to={`/disputes/${dispute.marketId}`}
                style={{ color: "inherit", textDecoration: "none", display: "block" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{dispute.marketTitle}</span>
                  <span className="badge yellow">
                    {dispute.votes.length} of {dispute.councilSize} votes
                  </span>
                </div>
                <code style={{ fontSize: 11, color: "var(--muted)" }}>{dispute.marketId}</code>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
