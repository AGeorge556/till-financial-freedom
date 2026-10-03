import { roundPiasters, type Piasters } from "./money";
import { goalStatus, monthsToTarget, requiredMonthlyContribution } from "./projection";
import { monthsRemaining } from "./time";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** A goal never holds money: its current amount is its allocations, or a labelled manual figure if it has none. */
export function goalCurrentAmount(
  allocations: Piasters[],
  manual: Piasters | null,
): { amount: Piasters; source: "allocations" | "manual" } {
  return allocations.length > 0
    ? { amount: sum(allocations), source: "allocations" }
    : { amount: manual ?? 0, source: "manual" };
}

/** Unallocated part of an account's balance. Never negative; a negative balance has nothing to allocate. */
export function accountFree(balance: Piasters, allocatedOnAccount: Piasters): Piasters {
  return Math.max(0, Math.max(0, balance) - allocatedOnAccount);
}

export function overAllocatedBy(balance: Piasters, allocatedOnAccount: Piasters): Piasters {
  return Math.max(0, allocatedOnAccount - Math.max(0, balance));
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
