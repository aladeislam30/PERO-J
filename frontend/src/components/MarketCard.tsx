import type { CSSProperties } from "react";
import type { Market } from "../api";

type OracleStatus = {
  label: string;
  description: string;
  background: string;
  color: string;
};

const ORACLE_STATUSES: Record<string, OracleStatus> = {
  pending: {
    label: "Open",
    description: "No oracle outcome has been proposed yet.",
    background: "#f1f3f5",
    color: "#57606a",
  },
  open: {
    label: "Open",
    description: "No oracle outcome has been proposed yet.",
    background: "#f1f3f5",
    color: "#57606a",
  },
  submitted: {
    label: "Outcome Proposed",
    description: "An oracle has proposed an outcome; the challenge period is active.",
    background: "#fff8c5",
    color: "#7d4e00",
  },
  proposed: {
    label: "Outcome Proposed",
    description: "An oracle has proposed an outcome; the challenge period is active.",
    background: "#fff8c5",
    color: "#7d4e00",
  },
  disputed: {
    label: "Dispute Active",
    description: "The proposed outcome has been challenged and is being disputed.",
    background: "#ffebe9",
    color: "#a40e26",
  },
  challenged: {
    label: "Dispute Active",
    description: "The proposed outcome has been challenged and is being disputed.",
    background: "#ffebe9",
    color: "#a40e26",
  },
  council_review: {
    label: "Council Review",
    description: "The dispute is under review by the oracle council.",
    background: "#f3e8ff",
    color: "#6b21a8",
  },
  "council-review": {
    label: "Council Review",
    description: "The dispute is under review by the oracle council.",
    background: "#f3e8ff",
    color: "#6b21a8",
  },
  finalized: {
    label: "Finalized",
    description: "The oracle outcome is final.",
    background: "#dafbe1",
    color: "#116329",
  },
  closed: {
    label: "Closed",
    description: "This market is closed.",
    background: "#f1f3f5",
    color: "#57606a",
  },
};

export function getOracleStatus(state?: string | null): OracleStatus {
  const normalized = state?.trim().toLowerCase();
  if (!normalized) {
    return {
      label: "Status unavailable",
      description: "Oracle status has not been reported.",
      background: "#f1f3f5",
      color: "#57606a",
    };
  }
  return ORACLE_STATUSES[normalized] ?? {
    label: normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: `Oracle state: ${normalized}.`,
    background: "#f1f3f5",
    color: "#57606a",
  };
}

export function MarketOracleBadge({ state }: { state?: string | null }) {
  const status = getOracleStatus(state);
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "3px 9px",
    background: status.background,
    color: status.color,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };

  return (
    <span role="status" aria-label={status.label} title={status.description} style={style}>
      {status.label}
    </span>
  );
}

function truncateId(id: string) {
  return id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id;
}

export default function MarketCard({ market }: { market: Market }) {
  return (
    <article className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <h3 style={{ fontSize: 15, overflowWrap: "anywhere" }}>{market.id}</h3>
        <MarketOracleBadge state={market.oracle_state} />
      </div>
      {market.outcome && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Proposed outcome: {market.outcome}
        </p>
      )}
      <div style={{ color: "var(--muted)", fontSize: 12 }}>
        Contract: <code title={market.contract_id}>{truncateId(market.contract_id)}</code>
      </div>
    </article>
  );
}
