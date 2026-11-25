import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../components/Toast";
import { markets } from "../markets/config";
import { writeMarket } from "../markets/storage";
import MarketPage from "./MarketPage";

const challengeControl = vi.hoisted(() => ({
  resolve: (_value: { txHash: string; ledger: number }) => {},
  reject: (_error: Error) => {},
}));

vi.mock("../markets/finalizeGateway", () => ({
  SorobanFinalizeGateway: class {
    async finalizeOutcome() {
      return { txHash: "f".repeat(64), ledger: 123 };
    }
  },
}));

vi.mock("../markets/challengeGateway", () => ({
  SorobanChallengeGateway: class {
    challengeOutcome() {
      return new Promise<{ txHash: string; ledger: number }>((resolve, reject) => {
        challengeControl.resolve = resolve;
        challengeControl.reject = reject;
      });
    }
  },
}));

function renderMarket() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/market/next_ledger"]}>
          <Routes>
            <Route path="/market/:id" element={<MarketPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("MarketPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("transitions to the claimable state after finalization succeeds", async () => {
    renderMarket();

    fireEvent.click(screen.getByRole("button", { name: "Finalize Market" }));

    await waitFor(() => {
      expect(screen.getByText("Claimable")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Finalize Market" })).toBeNull();
    expect(screen.getByRole("link", { name: /Finalization tx/ })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${"f".repeat(64)}`
    );
  });

  function openChallengeWithFutureDeadline() {
    writeMarket({
      ...markets[0],
      oracleState: "submitted",
      challengeDeadline: new Date(Date.now() + 3_600_000).toISOString(),
    });
    renderMarket();
    fireEvent.click(screen.getByRole("button", { name: "Challenge outcome" }));
    fireEvent.click(screen.getByRole("button", { name: "Post challenge bond" }));
  }

  it("shows the challenged state optimistically while the challenge is signing", async () => {
    openChallengeWithFutureDeadline();

    expect(screen.getByText("Challenged")).toBeInTheDocument();

    await act(async () => {
      challengeControl.resolve({ txHash: "c".repeat(64), ledger: 321 });
    });

    expect(screen.getByText("Challenged")).toBeInTheDocument();
  });

  it("rolls back the optimistic state when signing fails", async () => {
    openChallengeWithFutureDeadline();

    expect(screen.getByText("Challenged")).toBeInTheDocument();

    await act(async () => {
      challengeControl.reject(new Error("Signing cancelled."));
    });

    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Signing cancelled.")).toBeInTheDocument();
  });
});
