import { roundPiasters, type Piasters } from "./money";
import { goalStatus, monthsToTarget, requiredMonthlyContribution } from "./projection";
import { monthsRemaining } from "./time";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// BigInt() calls, not 1n literals: tsconfig targets below ES2020. Shares are NUMERIC(8,6) decimal strings.
const SCALE = BigInt(1000000);
const TWO = BigInt(2);
const SHARE = /^\d+(\.\d{1,6})?$/;

function toShare(percent: string): bigint {
  if (!SHARE.test(percent)) throw new RangeError(`Share must be a decimal with at most 6 places: ${percent}`);
  const [whole, frac = ""] = percent.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(6, "0"));
}

function fromShare(n: bigint): string {
  const abs = n < BigInt(0) ? -n : n;
  const frac = (abs % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${n < BigInt(0) ? "-" : ""}${abs / SCALE}${frac ? "." + frac : ""}`;
}

// Round-half-up integer division, non-negative operands.
const divRound = (n: bigint, d: bigint) => (TWO * n + d) / (TWO * d);

/** share x value, whole piasters, exact until the single final rounding (half up). `percent` is a decimal fraction (0.25 = 25%). */
export function shareValue(holdingValue: Piasters, percent: string): Piasters {
  if (!Number.isSafeInteger(holdingValue) || holdingValue < 0) throw new RangeError(`Holding value must be a non-negative integer of piasters: ${holdingValue}`);
  return Number(divRound(BigInt(holdingValue) * toShare(percent), SCALE));
}

/** What a goal holds from one source: cash earmarked on an account, or a percentage share of a holding's current value. */
export type AllocationSource =
  | { kind: "cash"; amount: Piasters }
  | { kind: "holding"; percent: string; holdingValue: Piasters };

export const sourceValue = (a: AllocationSource): Piasters =>
  a.kind === "cash" ? a.amount : shareValue(a.holdingValue, a.percent);

/** A goal never holds money: its current amount is its allocations (holding shares move with the market), or a labelled manual figure if it has none. */
export function goalCurrentAmount(
  allocations: AllocationSource[],
  manual: Piasters | null,
): { amount: Piasters; source: "allocations" | "manual" } {
  return allocations.length > 0
    ? { amount: sum(allocations.map(sourceValue)), source: "allocations" }
    : { amount: manual ?? 0, source: "manual" };
}

/** Part of a holding no goal has claimed, as a decimal fraction. Never negative. */
export function holdingFreeShare(percents: string[]): string {
  const free = SCALE - percents.reduce((s, p) => s + toShare(p), BigInt(0));
  return fromShare(free > BigInt(0) ? free : BigInt(0));
}

export type ShareCheck =
  | { ok: true }
  | { ok: false; error: "invalid-percent" }
  | { ok: false; error: "exceeds-free"; free: string };

/**
 * Shares of one holding across all goals must sum to at most 100%, in exact 6-decimal fixed-point.
 * `totalOnHolding` is every goal's share including this goal's `current`. "0" = remove the share.
 * Decreases always pass.
 */
export function validateShareChange(totalOnHolding: string, current: string, next: string): ShareCheck {
  if (!SHARE.test(next) || toShare(next) > SCALE) return { ok: false, error: "invalid-percent" };
  const n = toShare(next);
  const c = toShare(current);
  if (n <= c) return { ok: true };
  const free = SCALE - toShare(totalOnHolding);
  return n - c <= free ? { ok: true } : { ok: false, error: "exceeds-free", free: fromShare(free > BigInt(0) ? free : BigInt(0)) };
}

/**
 * The goal_allocation_events row for a share change: the signed share delta and its EGP value at this moment
 * (value of the delta at today's price), so actualContribution never counts later market growth. Zero change = null.
 */
export function shareChangeEvent(
  currentPercent: string,
  nextPercent: string,
  holdingValue: Piasters,
): { percentDelta: string; delta: Piasters } | null {
  const diff = toShare(nextPercent) - toShare(currentPercent);
  if (diff === BigInt(0)) return null;
  const value = shareValue(holdingValue, fromShare(diff < BigInt(0) ? -diff : diff));
  return { percentDelta: fromShare(diff), delta: diff < BigInt(0) ? -value : value };
}

/** Unallocated part of an account's balance. Never negative; a negative balance has nothing to allocate. */
export function accountFree(balance: Piasters, allocatedOnAccount: Piasters): Piasters {
  return Math.max(0, Math.max(0, balance) - allocatedOnAccount);
}

export function overAllocatedBy(balance: Piasters, allocatedOnAccount: Piasters): Piasters {
  return Math.max(0, allocatedOnAccount - Math.max(0, balance));
}

/**
 * Splits an account's over-allocation across its cash allocations, newest first: each takes up to its own amount
 * until the figure is used up, so the shares sum exactly to `accountOver` (id -> share, in the order given).
 * `accountOver` can never exceed the allocations' total; if it does the inputs are inconsistent.
 */
export function attributeOverAllocation(
  accountOver: Piasters,
  allocationsNewestFirst: { id: string; amount: Piasters }[],
): Map<string, Piasters> {
  if (accountOver > sum(allocationsNewestFirst.map((a) => a.amount))) {
    throw new RangeError("Over-allocation is larger than the allocations on the account");
  }
  const shares = new Map<string, Piasters>();
  let left = accountOver;
  for (const a of allocationsNewestFirst) {
    const share = Math.min(a.amount, left);
    shares.set(a.id, share);
    left -= share;
  }
  return shares;
}

export type AllocationCheck =
  | { ok: true }
  | { ok: false; error: "invalid-amount" }
  | { ok: false; error: "exceeds-free"; free: Piasters };

/**
 * Rule B. `totalOnAccount` is every goal's allocation on the account including this goal's `current`.
 * 0 = remove the allocation. Decreases always pass, even when the account is already over-allocated.
 */
export function validateAllocationChange(
  balance: Piasters,
  totalOnAccount: Piasters,
  current: Piasters,
  next: Piasters,
): AllocationCheck {
  if (!Number.isSafeInteger(next) || next < 0) return { ok: false, error: "invalid-amount" };
  if (next <= current) return { ok: true };
  const free = accountFree(balance, totalOnAccount);
  return next - current <= free ? { ok: true } : { ok: false, error: "exceeds-free", free };
}

/** Net new allocation (signed sum of deltas) dated within the inclusive range. Never touches a ledger balance. */
export function actualContribution(
  events: { date: string; delta: Piasters }[],
  range: { start: string; end: string },
): Piasters {
  return sum(events.filter((e) => e.date >= range.start && e.date <= range.end).map((e) => e.delta));
}

export type AssumedReturns = { cashReturn: number | null; stockReturn: number | null; goldReturn: number | null };

/**
 * The assumed annual return of one source (null = not set, which blendedReturn counts as 0): cash accounts use
 * cash_return, stock/fund/other use stock_return, gold uses gold_return, a cloud uses its own current APY.
 */
export function sourceReturn(
  source: { kind: "cash" } | { kind: "stock" | "fund" | "other" | "gold" } | { kind: "cloud"; apy: number | null },
  assumed: AssumedReturns,
): number | null {
  switch (source.kind) {
    case "cash":
      return assumed.cashReturn;
    case "gold":
      return assumed.goldReturn;
    case "cloud":
      return source.apy;
    default:
      return assumed.stockReturn;
  }
}

/** Rule D. A null rate (e.g. unset cash return) counts as 0. */
export function blendedReturn(
  sources: { value: Piasters; rate: number | null }[],
  override?: number | null,
): { rate: number; source: "override" | "blended" } {
  if (override != null) return { rate: override, source: "override" };
  const total = sum(sources.map((s) => Math.max(0, s.value)));
  if (total === 0) return { rate: 0, source: "blended" };
  return {
    rate: sum(sources.map((s) => Math.max(0, s.value) * (s.rate ?? 0))) / total,
    source: "blended",
  };
}

/** Rule E. `ruleFunded` is what the allocation rules fund this month, or null if no rule targets the goal. */
export function plannedMonthly(
  ruleFunded: Piasters | null,
  goalPlanned: Piasters | null,
): { amount: Piasters; source: "rules" | "goal" } {
  return ruleFunded !== null
    ? { amount: ruleFunded, source: "rules" }
    : { amount: goalPlanned ?? 0, source: "goal" };
}

export interface GoalProjection {
  monthsRemaining: number;
  required: Piasters | "target-date-passed";
  projectedAtTarget: Piasters;
  onTrack: boolean;
  /** projectedAtTarget - target; negative = short by that much. */
  gap: Piasters;
  /** Months to reach the target minus months remaining: positive = late, negative = early, null = never. */
  monthsLate: number | null;
  projectedMonths: number | "unreachable";
}

/** Rule I, composed from projection.ts and time.ts. */
export function goalProjection(input: {
  target: Piasters;
  current: Piasters;
  plannedMonthly: Piasters;
  annualReturn: number;
  today: string;
  targetDate: string;
  startDay: number;
  contributedThisMonth: boolean;
}): GoalProjection {
  const { target, current, annualReturn } = input;
  const n = monthsRemaining(input.today, input.targetDate, input.startDay, input.contributedThisMonth);
  const req = requiredMonthlyContribution(target, current, annualReturn, n);
  const status = goalStatus(target, current, input.plannedMonthly, annualReturn, n);
  const needed = monthsToTarget(target, current, input.plannedMonthly, annualReturn);
  return {
    monthsRemaining: n,
    required: req.kind === "required" ? req.monthly : "target-date-passed",
    projectedAtTarget: status.projected,
    onTrack: status.onTrack,
    gap: status.gap,
    monthsLate: status.monthsLate,
    projectedMonths: needed.kind === "months" ? needed.months : "unreachable",
  };
}

const TRAILING_MONTHS = 3;

/**
 * Rule H: average of the last 3 FULL months (oldest first; the caller excludes the current month).
 * Fewer than 3 full months -> null, so the entered figures apply.
 */
export function trailingCapacity(
  months: { income: Piasters; spending: Piasters; full: boolean }[],
): { income: Piasters; spending: Piasters; capacity: Piasters } | null {
  const last = months.filter((m) => m.full).slice(-TRAILING_MONTHS);
  if (last.length < TRAILING_MONTHS) return null;
  const income = roundPiasters(sum(last.map((m) => m.income)) / TRAILING_MONTHS);
  const spending = roundPiasters(sum(last.map((m) => m.spending)) / TRAILING_MONTHS);
  return { income, spending, capacity: income - spending };
}
