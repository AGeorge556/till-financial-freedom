import { periodSummary, type Tx } from "./ledger";
import { roundPiasters, type Piasters } from "./money";
import { daysBetween } from "./recurring";

export const DEFAULT_BUDGET_WARN_AT = 0.8;
export const DEFAULT_BUDGET_ALERT_AT = 1.0;

/** An expense row; `fixed` = it came from a recurring template, so it is never extrapolated per day. */
export type BudgetTx = Tx & { fixed: boolean };

export type BudgetStatus = {
  budget: Piasters;
  spent: Piasters;
  /** Negative once the budget is exceeded. */
  remaining: Piasters;
  /** Decimal: 0.8 = 80%. */
  percentUsed: number;
  projected: Piasters;
  /** "alert" = past the configured alert level; "over" only when spent is actually above the budget. */
  level: "ok" | "warn" | "alert" | "over";
  /** The projected month-end spending exceeds the budget (whether or not spending has already). */
  projectedOver: boolean;
};

/**
 * One budget (overall or one category) for one financial month. Callers pass the rows in scope; only posted
 * EXPENSE rows dated inside the month count, so pending rows never reduce a budget. `upcomingFixed` is the sum of
 * recurring expenses still to come this month (upcomingInMonth).
 * Projection = spent + upcomingFixed + variable spending so far / days elapsed x days remaining. A month that is
 * over projects to what was spent.
 */
export function budgetStatus(input: {
  budget: Piasters;
  expenses: BudgetTx[];
  upcomingFixed: Piasters;
  monthRange: { start: string; end: string };
  today: string;
  warnAt: number;
  alertAt: number;
}): BudgetStatus {
  const { budget, monthRange, today, warnAt, alertAt } = input;
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new RangeError(`Budget must be a positive integer of piasters: ${budget}`);

  const inMonth = input.expenses.filter((t) => t.date >= monthRange.start && t.date <= monthRange.end);
  const spent = periodSummary(inMonth).spending;
  const variableSpent = periodSummary(inMonth.filter((t) => !t.fixed)).spending;

  const total = daysBetween(monthRange.start, monthRange.end) + 1;
  const elapsed = Math.min(total, Math.max(0, daysBetween(monthRange.start, today) + 1));
  const monthOver = today > monthRange.end;
  // Before the month starts there is no day to extrapolate from, so only the known fixed items project.
  const variableRest = elapsed === 0 ? 0 : (variableSpent * (total - elapsed)) / elapsed;
  const projected = monthOver ? spent : roundPiasters(spent + input.upcomingFixed + variableRest);

  const percentUsed = spent / budget;
  return {
    budget,
    spent,
    remaining: budget - spent,
    percentUsed,
    projected,
    level: spent > budget ? "over" : percentUsed >= alertAt ? "alert" : percentUsed >= warnAt ? "warn" : "ok",
    projectedOver: projected > budget,
  };
}
