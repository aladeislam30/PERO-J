import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import { SorobanFinalizeGateway, type FinalizeGateway } from "../markets/finalizeGateway";
import type { FinalizeResult, OracleState } from "../markets/types";

interface Props {
  marketId: string;
  oracleState: OracleState;
  challengeDeadline: string;
  onFinalized: (result: FinalizeResult) => void;
  gateway?: FinalizeGateway;
}

export default function FinalizeMarketButton({
  marketId,
  oracleState,
  challengeDeadline,
  onFinalized,
  gateway,
}: Props) {
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const deadlineMs = Date.parse(challengeDeadline);
  const deadlinePassed = Number.isFinite(deadlineMs) && now >= deadlineMs;
  const isFinalizable = oracleState === "submitted" && deadlinePassed;

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    const remaining = deadlineMs - Date.now();
    const timeout = remaining > 0 ? window.setTimeout(() => setNow(Date.now()), remaining) : undefined;

    return () => {
      window.clearInterval(interval);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [deadlineMs]);

  if (oracleState !== "submitted") return null;

  async function handleFinalize() {
    setPending(true);
    try {
      const activeGateway = gateway ?? new SorobanFinalizeGateway();
      const result = await activeGateway.finalizeOutcome(marketId);
      onFinalized(result);
      toast.success("Market finalized! The outcome is now claimable.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not finalize the market.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="finalize-action" data-finalizable={isFinalizable}>
      <button
        type="button"
        className="finalize-button"
        disabled={!isFinalizable || pending}
        onClick={() => void handleFinalize()}
      >
        {pending ? "Finalizing…" : "Finalize Market"}
      </button>
      {!isFinalizable && (
        <span className="finalize-countdown" role="status">
          {formatCountdown(deadlineMs - now)}
        </span>
      )}
    </div>
  );
}

function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "Challenge window closed";

  const totalSeconds = Math.ceil(ms / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0"));

  return `Challenge window closes in ${days > 0 ? `${days}d ` : ""}${parts.join(":")}`;
}
