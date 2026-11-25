import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import CouncilVoteProgress from "../components/CouncilVoteProgress";
import DisputeTimeline from "../components/DisputeTimeline";
import { useDispute } from "../hooks/useDisputes";
import { formatXlm, shortenTxHash, stellarExpertTxUrl } from "../oracleBonds";

export default function DisputeDetailPage() {
  const { marketId = "" } = useParams();
  const dispute = useDispute(marketId);

  useEffect(() => {
    document.title = dispute
      ? `Dispute: ${dispute.marketTitle} - Soroban Smart Block Explorer`
      : "Dispute - Soroban Smart Block Explorer";
  }, [dispute]);

  if (!dispute) {
    return (
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Dispute not found</h2>
        <p style={{ color: "var(--muted)" }}>
          No dispute is available for market <code>{marketId}</code>. <Link to="/disputes">Browse disputes</Link>
        </p>
      </div>
    );
  }

  const evidence = [
    {
      label: "Submitter bond transaction",
      url: stellarExpertTxUrl(dispute.submitterTxHash),
    },
    {
      label: "Challenger bond transaction",
      url: stellarExpertTxUrl(dispute.challengerTxHash),
    },
    ...dispute.evidenceLinks,
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 8 }}>{dispute.marketTitle}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="badge yellow">In dispute</span>
              <Link to={`/market/${dispute.marketId}`}>Back to market</Link>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Resolution deadline</div>
            <strong>{new Date(dispute.resolutionDeadline).toLocaleString()}</strong>
          </div>
        </div>
      </section>

      <div className="party-grid">
        <section className="card">
          <h3 style={{ marginBottom: 12 }}>Submitter</h3>
          <dl className="party-facts">
            <dt>Submitter address</dt>
            <dd><code style={{ wordBreak: "break-all" }}>{dispute.submitterAddress}</code></dd>
            <dt>Proposed outcome</dt>
            <dd>{dispute.proposedOutcome}</dd>
            <dt>Bond posted</dt>
            <dd>{formatXlm(dispute.submitterBondXlm)}</dd>
          </dl>
          <a
            href={stellarExpertTxUrl(dispute.submitterTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            title={dispute.submitterTxHash}
          >
            Bond tx {shortenTxHash(dispute.submitterTxHash)} ↗
          </a>
        </section>

        <section className="card">
          <h3 style={{ marginBottom: 12 }}>Challenger</h3>
          <dl className="party-facts">
            <dt>Challenger address</dt>
            <dd><code style={{ wordBreak: "break-all" }}>{dispute.challengerAddress}</code></dd>
            <dt>Disputed outcome</dt>
            <dd>{dispute.disputedOutcome}</dd>
            <dt>Bond posted</dt>
            <dd>{formatXlm(dispute.challengerBondXlm)}</dd>
          </dl>
          <a
            href={stellarExpertTxUrl(dispute.challengerTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            title={dispute.challengerTxHash}
          >
            Bond tx {shortenTxHash(dispute.challengerTxHash)} ↗
          </a>
        </section>
      </div>

      <section className="card">
        <h3 style={{ marginBottom: 12 }}>Council votes</h3>
        <CouncilVoteProgress votes={dispute.votes} councilSize={dispute.councilSize} />
      </section>

      <section className="card">
        <h3 style={{ marginBottom: 12 }}>Audit evidence</h3>
        <ul className="evidence-list">
          {evidence.map((link) => (
            <li key={`${link.label}-${link.url}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3 style={{ marginBottom: 12 }}>Dispute timeline</h3>
        <DisputeTimeline events={dispute.timeline} />
      </section>
    </div>
  );
}
