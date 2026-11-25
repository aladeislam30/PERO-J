import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FinalizeMarketButton from "./FinalizeMarketButton";
import { ToastProvider } from "./Toast";
import type { FinalizeGateway } from "../markets/finalizeGateway";
import type { OracleState } from "../markets/types";

const pastDeadline = new Date(Date.now() - 60_000).toISOString();
const futureDeadline = new Date(Date.now() + 60_000).toISOString();

function renderButton({
  oracleState = "submitted" as OracleState,
  challengeDeadline = pastDeadline,
  onFinalized = vi.fn(),
  gateway = { finalizeOutcome: vi.fn().mockResolvedValue({ txHash: "tx-hash", ledger: 42 }) } as FinalizeGateway,
} = {}) {
  render(
    <ToastProvider>
      <FinalizeMarketButton
        marketId="next_ledger"
        oracleState={oracleState}
        challengeDeadline={challengeDeadline}
        onFinalized={onFinalized}
        gateway={gateway}
      />
    </ToastProvider>
  );
  return { onFinalized };
}

describe("FinalizeMarketButton", () => {
  it("is enabled as soon as the challenge deadline has passed", () => {
    renderButton();

    const button = screen.getByRole("button", { name: "Finalize Market" });
    expect(button).toBeEnabled();
    expect(screen.queryByText(/Challenge window closes in/)).toBeNull();
  });

  it("stays disabled with a countdown while the challenge window is open", () => {
    renderButton({ challengeDeadline: futureDeadline });

    expect(screen.getByRole("button", { name: "Finalize Market" })).toBeDisabled();
    expect(screen.getByText(/Challenge window closes in/)).toBeInTheDocument();
  });

  it("is hidden once the market is finalized", () => {
    renderButton({ oracleState: "finalized" });

    expect(screen.queryByRole("button", { name: "Finalize Market" })).toBeNull();
  });

  it("finalizes on Soroban, celebrates and reports the result", async () => {
    const gateway: FinalizeGateway = {
      finalizeOutcome: vi.fn().mockResolvedValue({ txHash: "tx-hash", ledger: 42 }),
    };
    const { onFinalized } = renderButton({ gateway });

    fireEvent.click(screen.getByRole("button", { name: "Finalize Market" }));

    await waitFor(() => {
      expect(gateway.finalizeOutcome).toHaveBeenCalledWith("next_ledger");
      expect(onFinalized).toHaveBeenCalledWith({ txHash: "tx-hash", ledger: 42 });
    });
    expect(screen.getByText("Market finalized! The outcome is now claimable.")).toBeInTheDocument();
  });
});
