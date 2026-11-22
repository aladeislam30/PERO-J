import { useId, useMemo, useState } from "react";

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
  pool: number;
  totalPool?: number;
  maxStake?: number;
  initialStake?: number;
  step?: number;
  asset?: string;
  outcome?: string;
  onStakeChange?: (stake: number) => void;
  onPlaceBet?: (stake: number, netReturn: number) => void;
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

function formatAmount(value: number, asset?: string): string {
  const amount = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return asset ? `${amount} ${asset}` : amount;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
}

export default function BetSlip({
  pool,
  totalPool = pool,
  maxStake,
  initialStake = 0,
  step = 1,
  asset = "XLM",
  outcome,
  onStakeChange,
  onPlaceBet,
}: BetSlipProps) {
  const stakeInputId = useId();
  const [stakeText, setStakeText] = useState(String(nonNegative(initialStake)));

  const stake = nonNegative(Number(stakeText));
  const sliderMax = Math.max(step, maxStake && maxStake > 0 ? maxStake : pool || 100, stake);
  const estimate = useMemo(
    () => calculatePayout(stake, pool, totalPool),
    [stake, pool, totalPool],
  );

  function updateStake(next: number) {
    const value = nonNegative(next);
    setStakeText(String(value));
    onStakeChange?.(value);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    setStakeText(text);
    const value = Number(text);
    onStakeChange?.(Number.isFinite(value) && value > 0 ? value : 0);
  }

  return (
    <section className="card" aria-label="Bet slip payout calculator" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>
          {outcome ? `Bet on ${outcome}` : "Bet Slip"}
        </h3>
        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          Estimate your payout before placing a bet.
        </p>
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
          onChange={event => updateStake(Number(event.target.value))}
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

      <button
        type="button"
        disabled={stake <= 0}
        onClick={() => onPlaceBet?.(stake, estimate.netReturn)}
      >
        Place bet
      </button>
    </section>
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
