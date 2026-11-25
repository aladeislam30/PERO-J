import { useId, useMemo, useState, useCallback } from "react";

export const PROTOCOL_FEE_RATE = 0.02;

export interface PayoutEstimate {
  grossPayout: number;
  protocolFee: number;
  netReturn: number;
  profit: number;
  multiplier: number;
  roi: number;
}

export interface BetSlipProps {
  pool?: number;
  poolSize?: number;
  totalPool?: number;
  maxStake?: number;
  initialStake?: number;
  step?: number;
  asset?: string;
  outcome?: string;
  marketLabel?: string;
  onStakeChange?: (stake: number) => void;
  onPlaceBet?: (stake: number, netReturn?: number) => void;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculatePayout(stake: number, pool: number, totalPool: number = pool): PayoutEstimate {
  const s = nonNegative(stake);
  const p = nonNegative(pool);
  const t = nonNegative(totalPool);
  const denominator = p + s;
  const grossPayout = denominator > 0 ? (s / denominator) * t : 0;
  const protocolFee = grossPayout * PROTOCOL_FEE_RATE;
  const netReturn = grossPayout - protocolFee;
  const profit = netReturn - s;

  return {
    grossPayout,
    protocolFee,
    netReturn,
    profit,
    multiplier: s > 0 ? netReturn / s : 0,
    roi: s > 0 ? (profit / s) * 100 : 0,
  };
}

export function formatAmount(value: number, asset?: string): string {
  const amount = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return asset ? `${amount} ${asset}` : amount;
}

export function formatMultiplier(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
}

export default function BetSlip({
  pool,
  poolSize,
  totalPool,
  maxStake,
  initialStake = 10,
  step = 1,
  asset = "XLM",
  outcome,
  marketLabel,
  onStakeChange,
  onPlaceBet,
}: BetSlipProps) {
  const effectivePool = pool ?? poolSize ?? 1000;
  const effectiveTotalPool = totalPool ?? (pool ? pool : 5000);
  const effectiveLabel = outcome ?? marketLabel ?? "Outcome";

  const stakeInputId = useId();
  const [stakeText, setStakeText] = useState(String(nonNegative(initialStake)));
  const [isOpen, setIsOpen] = useState(false);
  const [placed, setPlaced] = useState(false);

  const stake = nonNegative(Number(stakeText));
  const sliderMax = Math.max(step, maxStake && maxStake > 0 ? maxStake : effectivePool || 100, stake);
  const estimate = useMemo(
    () => calculatePayout(stake, effectivePool, effectiveTotalPool),
    [stake, effectivePool, effectiveTotalPool],
  );

  const updateStake = useCallback((next: number) => {
    const value = nonNegative(next);
    setStakeText(String(value));
    setPlaced(false);
    onStakeChange?.(value);
  }, [onStakeChange]);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    if (/^\d*\.?\d{0,2}$/.test(text) || text === "") {
      setStakeText(text);
      setPlaced(false);
      const value = Number(text);
      onStakeChange?.(Number.isFinite(value) && value > 0 ? value : 0);
    }
  }, [onStakeChange]);

  const handlePlaceBet = () => {
    if (stake <= 0) return;
    onPlaceBet?.(stake, estimate.netReturn);
    setPlaced(true);
  };

  return (
    <>
      <button
        type="button"
        className="bet-slip-trigger"
        onClick={() => setIsOpen(true)}
        aria-label="Open betting slip"
        aria-expanded={isOpen}
      >
        🎯 Place Bet
      </button>

      {isOpen && (
        <div
          className="bet-slip-backdrop"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`bet-slip${isOpen ? " bet-slip--open" : ""} card`}
        aria-label="Bet slip payout calculator"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div className="bet-slip__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 4 }}>
              {effectiveLabel ? `Bet on ${effectiveLabel}` : "Bet Slip"}
            </h3>
            <p style={{ color: "var(--muted)", fontSize: 12 }}>
              Estimate your payout before placing a bet.
            </p>
          </div>
          <button
            type="button"
            className="bet-slip__close"
            onClick={() => setIsOpen(false)}
            aria-label="Close betting slip"
          >
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label htmlFor={stakeInputId} style={{ fontWeight: 600 }}>Stake</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id={stakeInputId}
              type="number"
              min={0}
              step="any"
              value={stakeText}
              onChange={handleInputChange}
              style={{ flex: "1 1 120px" }}
            />
            {asset && <span style={{ color: "var(--muted)" }}>{asset}</span>}
          </div>
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={step}
            value={Math.min(stake, sliderMax)}
            onChange={(e) => updateStake(Number(e.target.value))}
            aria-label="Stake slider"
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 12 }}>
            <span>{formatAmount(0, asset)}</span>
            <span>{formatAmount(sliderMax, asset)}</span>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <h4 style={{ fontSize: 14, marginBottom: 4 }}>Estimated payout</h4>
          <DetailRow label="Gross payout" value={formatAmount(estimate.grossPayout, asset)} />
          <DetailRow
            label="Protocol fee (2%)"
            value={`-${formatAmount(estimate.protocolFee, asset)}`}
            tone="fee"
          />
          <DetailRow label="Net return" value={formatAmount(estimate.netReturn, asset)} tone="strong" />
          <DetailRow
            label="Potential profit"
            value={`${estimate.profit >= 0 ? "+" : "-"}${formatAmount(Math.abs(estimate.profit), asset)}`}
            tone={estimate.profit >= 0 ? "positive" : "negative"}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <span className="badge green">{formatMultiplier(estimate.multiplier)}</span>
            <span className={`badge ${estimate.roi >= 0 ? "green" : "yellow"}`}>
              {estimate.roi >= 0 ? "+" : ""}{estimate.roi.toFixed(1)}% ROI
            </span>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 12 }}>
            A 2% protocol fee is deducted from the gross payout. Figures update as you adjust your stake.
          </p>
        </div>

        {placed && (
          <div className="badge green" role="status" style={{ textAlign: "center", padding: "8px" }}>
            ✓ Bet placed successfully!
          </div>
        )}

        <button
          type="button"
          disabled={stake <= 0}
          onClick={handlePlaceBet}
          style={{ width: "100%" }}
        >
          Place bet
        </button>
      </aside>
    </>
  );
}

function DetailRow({ label, value, tone }: {
  label: string;
  value: string;
  tone?: "default" | "fee" | "strong" | "positive" | "negative";
}) {
  const color =
    tone === "fee" || tone === "negative" ? "var(--yellow)" :
    tone === "positive" ? "var(--green)" : undefined;

  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: color ?? "var(--muted)" }}>{label}</span>
      <strong style={{ color, fontWeight: tone === "strong" ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </strong>
    </div>
  );
}
