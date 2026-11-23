import { useState } from "react";
import { useToast } from "./Toast";
import { formatXlm } from "../oracleBonds";
import { SorobanChallengeGateway, type ChallengeGateway } from "../markets/challengeGateway";
import type { FinalizeResult } from "../markets/types";
import { formatCountdown, useCountdown } from "../hooks/useCountdown";

interface Props {
  open: boolean;
  marketId: string;
  challengeDeadline: string;
  requiredBondXlm: number;
  payoutRewardXlm: number;
  onClose: () => void;
  onOptimisticChallenge: () => void;
  onChallengeConfirmed: (result: FinalizeResult) => void;
  onChallengeFailed: () => void;
  gateway?: ChallengeGateway;
}

export default function ChallengeOutcomeModal({
  open,
  marketId,
  challengeDeadline,
  requiredBondXlm,
  payoutRewardXlm,
  onClose,
  onOptimisticChallenge,
  onChallengeConfirmed,
  onChallengeFailed,
  gateway,
}: Props) {
  const toast = useToast();
  const remaining = useCountdown(challengeDeadline);
  const [pending, setPending] = useState(false);
  const canChallenge = remaining > 0 && requiredBondXlm > 0;

  if (!open) return null;

  async function handleSubmit() {
    if (!canChallenge || pending) return;
    setPending(true);
    onOptimisticChallenge();

    try {
      const activeGateway = gateway ?? new SorobanChallengeGateway();
      const result = await activeGateway.challengeOutcome(marketId, requiredBondXlm);
      onChallengeConfirmed(result);
      toast.success("Challenge submitted. Council voting has started.");
      onClose();
    } catch (error) {
      onChallengeFailed();
      toast.error(error instanceof Error ? error.message : "Could not submit the challenge.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="challenge-modal" role="dialog" aria-modal="true" aria-labelledby="challenge-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 id="challenge-title">Challenge outcome</h2>
          <button type="button" aria-label="Close challenge dialog" onClick={onClose} disabled={pending}>
            ×
          </button>
        </div>

        <div className="challenge-countdown">
          <span>Challenge window closes in</span>
          <strong data-testid="challenge-countdown">
            {remaining > 0 ? formatCountdown(remaining) : "Closed"}
          </strong>
        </div>

        <dl className="party-facts" style={{ marginBottom: 12 }}>
          <dt>Required disputer bond</dt>
          <dd>{formatXlm(requiredBondXlm)}</dd>
          <dt>Payout reward on success</dt>
          <dd>{formatXlm(payoutRewardXlm)}</dd>
        </dl>
        <p style={{ color: "var(--muted)", marginBottom: 20 }}>
          Posting a challenge locks the disputer bond until the council resolves the dispute. A successful
          challenge returns the bond plus the reward.
        </p>

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="finalize-button"
            disabled={!canChallenge || pending}
            onClick={() => void handleSubmit()}
          >
            {pending ? "Submitting…" : "Post challenge bond"}
          </button>
        </div>
      </div>
    </div>
  );
}
