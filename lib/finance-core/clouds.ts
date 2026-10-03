import { roundPiasters, type Piasters } from "./money";
import { staleness } from "./portfolio";
import { futureValue } from "./projection";

/**
 * Savings Clouds: value-based holdings. The value is an ESTIMATE grown from the latest confirmed value (the anchor)
 * by the entered APY, which is an effective annual rate: growth over d days is (1 + apy)^(d / 365). Nothing is stored.
 */
type Stamp = { date: string; createdAt: string };

/** An APY (0.20 = 20%) in force from `date` until the next change. Rows are appended, never edited. */
export type RateChange = Stamp & { apy: number };
export type Confirmation = Stamp & { value: Piasters };
/** A deposit (INVESTMENT_PURCHASE) or withdrawal (INVESTMENT_SALE), `amount` always positive. */
export type CashFlow = Stamp & { kind: "deposit" | "withdrawal"; amount: Piasters };

export type CloudEstimate = {
  value: Piasters;
  /** Deposits minus withdrawals to date, never negative. */
  basis: Piasters;
  /** value - basis: market change, not income. */
  growth: Piasters;
  label: "estimated" | "confirmed";
  anchorDate: string | null;
};

/** Default for user_settings.stale_days_clouds. */
export const DEFAULT_STALE_DAYS_CLOUDS = 30;

const DAY_MS = 86_400_000;
const utcDay = (date: string): number => {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid date: ${date}`);
  return ms;
};
const daysBetween = (from: string, to: string): number => Math.round((utcDay(to) - utcDay(from)) / DAY_MS);

const before = (a: Stamp, b: Stamp) => a.date < b.date || (a.date === b.date && a.createdAt < b.createdAt);
const ordered = <T extends Stamp>(xs: T[]): T[] => [...xs].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));

/** The APY in force on `date` (latest change on or before it, ties by createdAt); null before the first one. */
export function apyAsOf(rates: RateChange[], date: string): number | null {
  let best: RateChange | null = null;
  for (const r of rates) if (r.date <= date && (!best || !before(r, best))) best = r;
  return best ? best.apy : null;
}

function checkApy(apy: number): number {
  if (!Number.isFinite(apy) || apy <= -1) throw new RangeError(`APY must be above -100%: ${apy}`);
  return apy;
}

/**
 * Growth multiplier from `from` to `to`, compounding each stretch at the APY in force then. Day counts / 365, so
 * exactly 365 days at 20% is x1.2. Before the first recorded rate there is no growth (a rate is never assumed).
 */
export function growthFactor(rates: RateChange[], from: string, to: string): number {
  if (to <= from) return 1;
  let factor = 1;
  let cursor = from;
  let apy = apyAsOf(rates, from) ?? 0;
  for (const r of ordered(rates)) {
    if (r.date <= from) continue;
    if (r.date >= to) break;
    factor *= (1 + checkApy(apy)) ** (daysBetween(cursor, r.date) / 365);
    cursor = r.date;
    apy = r.apy;
  }
  return factor * (1 + checkApy(apy)) ** (daysBetween(cursor, to) / 365);
}

function checkAmount(amount: Piasters, label: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError(`${label} must be a positive integer of piasters: ${amount}`);
}

/**
 * Value as of `asOf` from records dated on or before it only. A confirmation counts everything dated up to it
 * (same-day flows only if created after it); each later flow then grows from its own date across rate changes.
 * 'confirmed' only when asOf is the anchor date and nothing happened after the confirmation.
 */
export function cloudEstimate(input: {
  confirmations: Confirmation[];
  cashFlows: CashFlow[];
  rates: RateChange[];
  asOf: string;
}): CloudEstimate {
  const { rates, asOf } = input;
  const flows = input.cashFlows.filter((f) => f.date <= asOf);
  for (const f of flows) checkAmount(f.amount, `${f.kind} amount`);
  let anchor: Confirmation | null = null;
  for (const c of input.confirmations) {
    if (c.date > asOf) continue;
    if (!Number.isSafeInteger(c.value) || c.value < 0) throw new RangeError(`Confirmed value must be a non-negative integer of piasters: ${c.value}`);
    if (!anchor || !before(c, anchor)) anchor = c;
  }
  const after = anchor ? flows.filter((f) => before(anchor, f)) : flows;

  let raw = anchor ? anchor.value * growthFactor(rates, anchor.date, asOf) : 0;
  for (const f of after) raw += (f.kind === "deposit" ? f.amount : -f.amount) * growthFactor(rates, f.date, asOf);
  const value = Math.max(0, roundPiasters(raw));
  const basis = Math.max(0, flows.reduce((s, f) => s + (f.kind === "deposit" ? f.amount : -f.amount), 0));
  return {
    value,
    basis,
    growth: value - basis,
    label: anchor && anchor.date === asOf && after.length === 0 ? "confirmed" : "estimated",
    anchorDate: anchor ? anchor.date : null,
  };
}

export type WithdrawalCheck = { ok: true } | { ok: false; error: "invalid-amount" } | { ok: false; error: "exceeds-value"; value: Piasters };

/** `value` is the estimate as of the withdrawal date. Taking out exactly the estimated value is allowed. */
export function validateWithdrawal(amount: Piasters, value: Piasters): WithdrawalCheck {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: "invalid-amount" };
  return amount <= value ? { ok: true } : { ok: false, error: "exceeds-value", value };
}

/**
 * Refuses a record set (a back-dated entry, an edit, a void) that leaves a withdrawal larger than the estimate
 * just before it, which only counts records that come before the withdrawal.
 */
export function validateCloudHistory(input: {
  confirmations: Confirmation[];
  cashFlows: CashFlow[];
  rates: RateChange[];
}): { ok: true } | { ok: false; error: string; date: string } {
  const flows = ordered(input.cashFlows);
  for (let i = 0; i < flows.length; i++) {
    const w = flows[i];
    if (w.kind !== "withdrawal") continue;
    const e = cloudEstimate({
      confirmations: input.confirmations.filter((c) => before(c, w)),
      cashFlows: flows.slice(0, i),
      rates: input.rates,
      asOf: w.date,
    });
    if (w.amount > e.value) return { ok: false, error: "A withdrawal is larger than the cloud's estimated value", date: w.date };
  }
  return { ok: true };
}

/** Weekly contributions are taken as 52/12 per month. */
export type Contribution = { amount: Piasters; frequency: "weekly" | "monthly" };

/** Expected value after `months`, from the cloud's current APY (null = 0) and optional contribution. Assumed, not guaranteed. */
export function cloudProjection(input: {
  value: Piasters;
  apy: number | null;
  contribution: Contribution | null;
  months: number;
}): { projected: Piasters; monthlyContribution: Piasters; label: "expected" } {
  const { contribution } = input;
  const monthlyContribution = !contribution
    ? 0
    : contribution.frequency === "monthly"
      ? contribution.amount
      : roundPiasters((contribution.amount * 52) / 12);
  return {
    projected: futureValue(input.value, monthlyContribution, checkApy(input.apy ?? 0), input.months),
    monthlyContribution,
    label: "expected",
  };
}

/** Stale when the latest confirmation on or before `today` is older than `staleDays`; never confirmed is stale. */
export function cloudStaleness(confirmations: Confirmation[], today: string, staleDays: number): { days: number | null; stale: boolean } {
  const dates = confirmations.map((c) => c.date).filter((d) => d <= today);
  return staleness(dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null, today, staleDays);
}

/** One cloud as portfolioValue wants it. A cloud worth nothing is never stale. */
export function cloudLine(input: {
  id: string;
  confirmations: Confirmation[];
  cashFlows: CashFlow[];
  rates: RateChange[];
  today: string;
  staleDays?: number;
}): CloudEstimate & { id: string; days: number | null; stale: boolean } {
  const estimate = cloudEstimate({ ...input, asOf: input.today });
  const s = cloudStaleness(input.confirmations, input.today, input.staleDays ?? DEFAULT_STALE_DAYS_CLOUDS);
  return { id: input.id, ...estimate, days: s.days, stale: estimate.value > 0 && s.stale };
}
