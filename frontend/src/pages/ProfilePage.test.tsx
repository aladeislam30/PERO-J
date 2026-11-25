import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Keypair } from "@stellar/stellar-sdk";
import ProfilePage from "./ProfilePage";
import type { OracleBond } from "../oracleBonds";

vi.mock("../api", () => ({
  api: {
    wallet: vi.fn().mockResolvedValue({ events: [], total: 0, page: 1, limit: 25 }),
  },
}));

function renderProfile(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ProfilePage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("offers an Oracle Bonds tab alongside bet history", () => {
    renderProfile("/profile");

    expect(screen.getByRole("tab", { name: "Bet History" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Oracle Bonds/ })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: /Oracle Bonds/ }));

    expect(screen.getByRole("tab", { name: /Oracle Bonds/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Oracle Bonds" })).toBeInTheDocument();
    expect(screen.getByText("Enter a Stellar address to view oracle bonds.")).toBeInTheDocument();
  });

  it("displays the user's escrowed, returned and slashed bonds", () => {
    const address = Keypair.random().publicKey();
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
    localStorage.setItem(`pero-j:oracle-bonds:${address}`, JSON.stringify(bonds));

    renderProfile(`/profile?address=${address}`);
    fireEvent.click(screen.getByRole("tab", { name: /Oracle Bonds/ }));

    expect(screen.getByText("Will XLM reach $1 in 2026?")).toBeInTheDocument();
    expect(screen.getByText("Submitter")).toBeInTheDocument();
    expect(screen.getAllByText("Escrowed")).toHaveLength(2);
    expect(screen.getByText("Returned with reward (+12 XLM)")).toBeInTheDocument();
    expect(screen.getAllByText("Slashed")).toHaveLength(2);
    expect(screen.getAllByText("250 XLM")).toHaveLength(2);
    expect(screen.getAllByText("120.5 XLM")).toHaveLength(2);
    expect(screen.getAllByText("300 XLM")).toHaveLength(2);
  });
});
