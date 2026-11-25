import type { CSSProperties } from "react";
import {
  bondStatusLabel,
  formatXlm,
  roleLabel,
  shortenTxHash,
  stellarExpertTxUrl,
  type OracleBond,
  type OracleBondStatus,
} from "../oracleBonds";

interface Props {
  bonds: OracleBond[];
  emptyMessage?: string;
  emptySubtitle?: string;
}

const statusBadgeClass: Record<OracleBondStatus, string> = {
  escrowed: "yellow",
  returned: "green",
  slashed: "red",
};

export default function OracleBondsTable({
  bonds,
  emptyMessage = "No oracle bonds found.",
  emptySubtitle = "Bonds posted to oracle markets will appear here.",
}: Props) {
  if (!bonds.length) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginBottom: 16 }}
        >
          <path d="M12 2 2 7l10 5 10-5-10-5Z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text)", marginBottom: 8 }}>
          {emptyMessage}
        </p>
        <p style={{ fontSize: 14, color: "var(--muted)" }}>{emptySubtitle}</p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="bonds-table">
        <thead>
          <tr>
            <th scope="col">Market title</th>
            <th scope="col">Role</th>
            <th scope="col">Bond amount (XLM)</th>
            <th scope="col">Status</th>
            <th scope="col">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {bonds.map((bond) => (
            <tr key={bond.id} data-status={bond.status}>
              <td style={marketCell}>{bond.marketTitle}</td>
              <td>
                <span className="badge">{roleLabel(bond.role)}</span>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>{formatXlm(bond.amountXlm)}</td>
              <td>
                <span className={`badge ${statusBadgeClass[bond.status]}`}>
                  {bondStatusLabel(bond)}
                </span>
              </td>
              <td>
                <a
                  href={stellarExpertTxUrl(bond.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={bond.txHash}
                  style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}
                >
                  {shortenTxHash(bond.txHash)} ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const marketCell: CSSProperties = { maxWidth: 320, minWidth: 180 };
