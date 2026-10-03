import { roundPiasters, type Piasters } from "./money";

export const MAX_MONTHS = 1200; // 100 years

/** Effective annual rate (APY) to monthly rate. Never annual / 12. */
export function monthlyRate(annual: number): number {
  return Math.expm1(Math.log1p(annual) / 12);
}

function growthMinusOne(r: number, n: number): number {
  return Math.expm1(n * Math.log1p(r));
}

// Unrounded FV; n <= 0 means no periods.
function fvRaw(pv: number, pmt: number, annual: number, n: number): number {
  const months = Math.max(0, n);
  const r = monthlyRate(annual);
  if (r === 0) return pv + pmt * months;
  const gm1 = growthMinusOne(r, months);
  return pv * (1 + gm1) + (pmt * gm1) / r;
}

export function futureValue(pv: Piasters, pmt: Piasters, annual: number, n: number): Piasters {
  return roundPiasters(fvRaw(pv, pmt, annual, n));
}

export type RequiredContribution =
  | { kind: "required"; monthly: Piasters } // 0 = on track with no further contributions
  | { kind: "target-date-passed" };

export function requiredMonthlyContribution(
  target: Piasters,
  pv: Piasters,
  annual: number,
  n: number,
): RequiredContribution {
  if (n <= 0) {
    return pv >= target ? { kind: "required", monthly: 0 } : { kind: "target-date-passed" };
  }
  const r = monthlyRate(annual);
  const gm1 = growthMinusOne(r, n);
  const grown = pv * (1 + gm1);
  if (grown >= target) return { kind: "required", monthly: 0 };
  const pmt = r === 0 ? (target - pv) / n : ((target - grown) * r) / gm1;
  // Round UP so paying the required amount always reaches the target; the epsilon absorbs float noise.
  return { kind: "required", monthly: roundPiasters(Math.ceil(pmt - 1e-6)) };
}

export type MonthsToTarget = { kind: "months"; months: number } | { kind: "unreachable" };

export function monthsToTarget(
  target: Piasters,
  pv: Piasters,
  pmt: Piasters,
  annual: number,
): MonthsToTarget {
  if (pv >= target) return { kind: "months", months: 0 };
  const r = monthlyRate(annual);
  let n: number;
  if (r === 0) {
    if (pmt <= 0) return { kind: "unreachable" };
    n = (target - pv) / pmt;
  } else {
    const num = target * r + pmt;
    const den = pv * r + pmt;
    if (!(num > 0 && den > 0)) return { kind: "unreachable" };
    n = Math.log(num / den) / Math.log1p(r);
  }
  // +1: float error at exactly the cap must not read as unreachable; the loop below enforces the cap.
  if (!Number.isFinite(n) || n > MAX_MONTHS + 1) return { kind: "unreachable" };

  // Float error can push an exact answer up or down a month; settle it against the rounded projection.
  const reached = (m: number) => Math.round(fvRaw(pv, pmt, annual, m)) >= target;
  let months = Math.min(MAX_MONTHS, Math.max(1, Math.ceil(n)));
  while (months > 1 && reached(months - 1)) months--;
  while (!reached(months)) {
    if (++months > MAX_MONTHS) return { kind: "unreachable" };
  }
  return { kind: "months", months };
}

export interface GoalStatus {
  onTrack: boolean;
  projected: Piasters;
  /** projected - target; negative = shortfall. */
  gap: Piasters;
  /** Months to reach the target minus n; positive = late, negative = early, null = never reached. */
  monthsLate: number | null;
}

export function goalStatus(
  target: Piasters,
  pv: Piasters,
  pmt: Piasters,
  annual: number,
  n: number,
): GoalStatus {
  const projected = futureValue(pv, pmt, annual, n);
  const needed = monthsToTarget(target, pv, pmt, annual);
  return {
    onTrack: projected >= target,
    projected,
    gap: projected - target,
    monthsLate: needed.kind === "months" ? needed.months - n : null,
  };
}

export function inflationAdjustedTarget(target: Piasters, inflation: number, years: number): Piasters {
  return roundPiasters(target * (1 + inflation) ** years);
}

export function realRate(rate: number, inflation: number): number {
  return (1 + rate) / (1 + inflation) - 1;
}
