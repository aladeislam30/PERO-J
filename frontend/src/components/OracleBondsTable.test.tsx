import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OracleBondsTable from "./OracleBondsTable";
import type { OracleBond } from "../oracleBonds";

const bonds: OracleBond[] = [
  {
    id: "bond-1",
    marketTitle: "Will XLM reach $1 in 2026?",
    role: "submitter",
    amountXlm: 250,
    status: "escrowed",
    txHash: "a".repeat(64),
    createdAt: "2026-11-01T00:00:00.000Z",
  },
  {
    id: "bond-2",
    marketTitle: "Will Soroban ship v2?",
    role: "challenger",
    amountXlm: 120.5,
    status: "returned",
    rewardXlm: 12,
    txHash: "b".repeat(64),
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "bond-3",
    marketTitle: "Will the network upgrade land?",
    role: "challenger",
    amountXlm: 300,
    status: "slashed",
    txHash: "c".repeat(64),
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("OracleBondsTable", () => {
  it("renders every bond column and position", () => {
    render(<OracleBondsTable bonds={bonds} />);

    expect(screen.getByRole("columnheader", { name: "Market title" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Bond amount (XLM)" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Transaction" })).toBeInTheDocument();

    expect(screen.getByText("Will XLM reach $1 in 2026?")).toBeInTheDocument();
    expect(screen.getByText("Submitter")).toBeInTheDocument();
    expect(screen.getByText("250 XLM")).toBeInTheDocument();
    expect(screen.getByText("Escrowed")).toBeInTheDocument();
    expect(screen.getByText("Returned with reward (+12 XLM)")).toBeInTheDocument();
    expect(screen.getByText("Slashed")).toBeInTheDocument();
  });

  it("links each transaction hash to Stellar Expert", () => {
    render(<OracleBondsTable bonds={bonds} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${"a".repeat(64)}`
    );
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows an empty state when there are no bonds", () => {
    render(<OracleBondsTable bonds={[]} />);

    expect(screen.getByText("No oracle bonds found.")).toBeInTheDocument();
  });
});
