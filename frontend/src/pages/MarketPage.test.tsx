import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../components/Toast";
import MarketPage from "./MarketPage";

vi.mock("../markets/finalizeGateway", () => ({
  SorobanFinalizeGateway: class {
    async finalizeOutcome() {
      return { txHash: "f".repeat(64), ledger: 123 };
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
});
