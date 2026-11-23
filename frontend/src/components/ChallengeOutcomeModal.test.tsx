import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChallengeOutcomeModal from "./ChallengeOutcomeModal";
import { ToastProvider } from "./Toast";
import type { ChallengeGateway } from "../markets/challengeGateway";

interface Overrides {
  open?: boolean;
  challengeDeadline?: string;
  gateway?: ChallengeGateway;
  onClose?: () => void;
  onOptimisticChallenge?: () => void;
  onChallengeConfirmed?: () => void;
  onChallengeFailed?: () => void;
}

function renderModal(overrides: Overrides = {}) {
  const gateway = overrides.gateway ?? {
    challengeOutcome: vi.fn().mockResolvedValue({ txHash: "tx-hash", ledger: 7 }),
  };
  const callbacks = {
    onClose: overrides.onClose ?? vi.fn(),
    onOptimisticChallenge: overrides.onOptimisticChallenge ?? vi.fn(),
    onChallengeConfirmed: overrides.onChallengeConfirmed ?? vi.fn(),
    onChallengeFailed: overrides.onChallengeFailed ?? vi.fn(),
  };

  render(
    <ToastProvider>
      <ChallengeOutcomeModal
        open={overrides.open ?? true}
        marketId="next_ledger"
        challengeDeadline={overrides.challengeDeadline ?? new Date(Date.now() + 65_000).toISOString()}
        requiredBondXlm={300}
        payoutRewardXlm={60}
        gateway={gateway}
        {...callbacks}
      />
    </ToastProvider>
  );

  return { gateway, ...callbacks };
}

describe("ChallengeOutcomeModal", () => {
  it("updates the countdown every second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));

    try {
      renderModal({ challengeDeadline: "2026-11-23T12:01:05.000Z" });

      expect(screen.getByTestId("challenge-countdown")).toHaveTextContent("01:05");
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByTestId("challenge-countdown")).toHaveTextContent("01:04");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the required bond and payout reward", () => {
    renderModal();

    expect(screen.getByRole("heading", { name: "Challenge outcome" })).toBeInTheDocument();
    expect(screen.getByText("Required disputer bond")).toBeInTheDocument();
    expect(screen.getByText("300 XLM")).toBeInTheDocument();
    expect(screen.getByText("Payout reward on success")).toBeInTheDocument();
    expect(screen.getByText("60 XLM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post challenge bond" })).toBeEnabled();
  });

  it("disables the challenge action after the deadline", () => {
    renderModal({ challengeDeadline: new Date(Date.now() - 1_000).toISOString() });

    expect(screen.getByTestId("challenge-countdown")).toHaveTextContent("Closed");
    expect(screen.getByRole("button", { name: "Post challenge bond" })).toBeDisabled();
  });

  it("updates optimistically and confirms the signed challenge", async () => {
    const onOptimisticChallenge = vi.fn();
    const onChallengeConfirmed = vi.fn();
    const onClose = vi.fn();
    renderModal({ onOptimisticChallenge, onChallengeConfirmed, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Post challenge bond" }));

    await waitFor(() => {
      expect(onChallengeConfirmed).toHaveBeenCalledWith({ txHash: "tx-hash", ledger: 7 });
    });
    expect(onOptimisticChallenge).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByText("Challenge submitted. Council voting has started.")).toBeInTheDocument();
  });

  it("rolls back on failure and shows the error", async () => {
    const gateway: ChallengeGateway = {
      challengeOutcome: vi.fn().mockRejectedValue(new Error("Wallet rejected the transaction.")),
    };
    const onChallengeFailed = vi.fn();
    const onClose = vi.fn();
    renderModal({ gateway, onChallengeFailed, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Post challenge bond" }));

    await waitFor(() => {
      expect(onChallengeFailed).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Wallet rejected the transaction.")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderModal({ open: false });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
