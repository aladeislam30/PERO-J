import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ChallengeOutcomeModal from "../components/ChallengeOutcomeModal";
import FinalizeMarketButton from "../components/FinalizeMarketButton";
import { useCountdown, formatCountdown } from "../hooks/useCountdown";
import { useDispute } from "../hooks/useDisputes";
import { useMarket } from "../hooks/useMarkets";
import { markMarketChallenged, recordFinalization, writeMarket } from "../markets/storage";
import type { Market } from "../markets/types";
import { shortenTxHash, stellarExpertTxUrl } from "../oracleBonds";

export default function MarketPage() {
  const { id = "" } = useParams();
  const market = useMarket(id);
  const dispute = useDispute(id);
  const queryClient = useQueryClient();
  const remaining = useCountdown(market?.challengeDeadline ?? "");
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeSnapshot, setChallengeSnapshot] = useState<Market | undefined>();

  useEffect(() => {
    document.title = market
      ? `${market.title} - Soroban Smart Block Explorer`
      : "Market - Soroban Smart Block Explorer";
  }, [market]);

  if (!market) {
    return (
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Market not found</h2>
        <p style={{ color: "var(--muted)" }}>
          No market with id <code>{id}</code> is available. <Link to="/markets">Browse markets</Link>
        </p>
      </div>
    );
  }

  const isFinalized = market.oracleState === "finalized";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="card">
        <h2 style={{ marginBottom: 12 }}>{market.title}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`badge ${isFinalized ? "green" : "yellow"}`}>
            {isFinalized ? "Finalized" : market.oracleState === "challenged" ? "Challenged" : "Submitted"}
          </span>
          <code style={{ fontSize: 12, color: "var(--muted)" }}>{market.id}</code>
          {dispute && <Link to={`/disputes/${market.id}`}>View dispute details</Link>}
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginBottom: 12 }}>Outcome</h3>
        {isFinalized ? (
          <div className="claimable-state">
            <span className="badge green">Claimable</span>
            <p style={{ marginTop: 12 }}>
              The outcome is final. Payouts can now be claimed{market.outcome ? `: ${market.outcome}` : "."}
            </p>
            {market.finalizedTxHash && (
              <p style={{ marginTop: 12 }}>
                <a
                  href={stellarExpertTxUrl(market.finalizedTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={market.finalizedTxHash}
                >
                  Finalization tx {shortenTxHash(market.finalizedTxHash)} ↗
                </a>
              </p>
            )}
          </div>
        ) : (
          <>
            <p style={{ color: "var(--muted)", marginBottom: 12 }}>
              Challenge deadline: {new Date(market.challengeDeadline).toLocaleString()}
            </p>
            {remaining > 0 ? (
              <div className="finalize-action">
                <button type="button" className="finalize-button" onClick={() => setChallengeOpen(true)}>
                  Challenge outcome
                </button>
                <span className="finalize-countdown">
                  Challenge window closes in {formatCountdown(remaining)}
                </span>
              </div>
            ) : (
              <FinalizeMarketButton
                marketId={market.id}
                oracleState={market.oracleState}
                challengeDeadline={market.challengeDeadline}
                onFinalized={(result) => {
                  recordFinalization(market.id, result.txHash, result.ledger);
                  void queryClient.invalidateQueries({ queryKey: ["market", market.id] });
                }}
              />
            )}
          </>
        )}
      </section>

      <ChallengeOutcomeModal
        open={challengeOpen}
        marketId={market.id}
        challengeDeadline={market.challengeDeadline}
        requiredBondXlm={market.challengeBondXlm ?? 0}
        payoutRewardXlm={market.challengeRewardXlm ?? 0}
        onClose={() => setChallengeOpen(false)}
        onOptimisticChallenge={() => {
          setChallengeSnapshot(market);
          markMarketChallenged(market.id);
        }}
        onChallengeConfirmed={() => {
          setChallengeSnapshot(undefined);
          void queryClient.invalidateQueries({ queryKey: ["market", market.id] });
        }}
        onChallengeFailed={() => {
          setChallengeSnapshot((snapshot) => {
            if (snapshot) writeMarket(snapshot);
            return undefined;
          });
        }}
      />
    </div>
  );
}
