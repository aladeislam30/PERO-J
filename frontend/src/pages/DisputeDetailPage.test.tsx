import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import DisputeDetailPage from "./DisputeDetailPage";
import { disputes } from "../disputes/config";
import { castCouncilVote, writeDispute } from "../disputes/storage";

function renderDispute() {
  return render(
    <MemoryRouter initialEntries={["/disputes/next_ledger"]}>
      <Routes>
        <Route path="/disputes/:marketId" element={<DisputeDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DisputeDetailPage", () => {
  beforeEach(() => {
    localStorage.clear();
    writeDispute(disputes[0]);
  });

  it("shows both parties, bonds, votes, evidence and the timeline", () => {
    renderDispute();

    expect(
      screen.getByRole("heading", { name: "Will the next ledger confirm within 10 seconds?" })
    ).toBeInTheDocument();
    expect(screen.getByText("Submitter address")).toBeInTheDocument();
    expect(screen.getByText("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBeInTheDocument();
    expect(screen.getByText("Proposed outcome")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("Challenger address")).toBeInTheDocument();
    expect(screen.getByText("Disputed outcome")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.getByText("250 XLM")).toBeInTheDocument();
    expect(screen.getByText("300 XLM")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 votes reached")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByRole("link", { name: /Stellar Expert audit trail/ })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet"
    );
    expect(screen.getByText("Resolution deadline")).toBeInTheDocument();
    expect(screen.getByText("Outcome challenged")).toBeInTheDocument();
    expect(screen.getByText("Council voting opened")).toBeInTheDocument();
  });

  it("updates the tally immediately when a council member votes", async () => {
    renderDispute();

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");

    act(() => {
      castCouncilVote("next_ledger", "GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "challenger");
    });

    await waitFor(() => {
      expect(screen.getByText("4 of 4 votes reached")).toBeInTheDocument();
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  });

  it("shows a not-found state for unknown market ids", () => {
    render(
      <MemoryRouter initialEntries={["/disputes/unknown"]}>
        <Routes>
          <Route path="/disputes/:marketId" element={<DisputeDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Dispute not found" })).toBeInTheDocument();
  });
});
