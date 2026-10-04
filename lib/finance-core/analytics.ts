import { filterByDateRange, periodSummary, type Tx } from "./ledger";
import { roundPiasters, type Piasters } from "./money";
import { addDays, dateOn, daysBetween } from "./recurring";
import { financialMonth } from "./time";

/** N4 defaults, passed in by the caller: a change must be at least 15% AND at least 500 EGP to be worth surfacing. */
export const DEFAULT_NOTABLE_PERCENT = 0.15;
export const DEFAULT_NOTABLE_AMOUNT: Piasters = 50_000;

/** N2: the average covers the last 3 full months and needs at least 2. */
const AVERAGE_MONTHS = 3;
const MIN_MONTHS = 2;

export type CategorizedTx = Tx & { categoryId?: string | null };
type Range = { start: string; end: string };

/** Posted spending grouped by category or by paying account, largest first. A missing key (uncategorised) is null. */
export function spendingBy(txs: CategorizedTx[], key: "category" | "account"): { key: string | null; total: Piasters }[] {
  const groups = new Map<string | null, CategorizedTx[]>();
  for (const t of txs) {
    const k = (key === "category" ? t.categoryId : t.fromAccountId) ?? null;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups]
    .map(([k, group]) => ({ key: k, total: periodSummary(group).spending }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * Posted earned income (INCOME rows, not dividends or interest) grouped by category, largest first. `share` is the group's
 * part of the earned total (0 to 1). A missing category is null.
 */
export function incomeByCategory(txs: CategorizedTx[]): { key: string | null; total: Piasters; share: number }[] {
  const groups = new Map<string | null, CategorizedTx[]>();
  for (const t of txs) {
    const k = t.categoryId ?? null;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const all = periodSummary(txs).earnedIncome;
  return [...groups]
    .map(([k, group]) => {
      const total = periodSummary(group).earnedIncome;
      return { key: k, total, share: total / all };
    })
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function monthTotals(txs: Tx[], months: Range[]): (Range & { spending: Piasters; income: Piasters; savings: Piasters })[] {
  return months.map((m) => {
    const s = periodSummary(filterByDateRange(txs, m.start, m.end));
    return { ...m, spending: s.spending, income: s.totalIncome, savings: s.savings };
  });
}

/**
 * The most recent full financial months before the current one, oldest first (at most `max`). A month is full only if
 * data starts on or before its first day, so a month the user started tracking part-way through is left out.
 */
export function fullMonths(firstDataDate: string | null, today: string, startDay: number, max: number): Range[] {
  const out: Range[] = [];
  if (firstDataDate === null) return out;
  let month = financialMonth(today, startDay);
  while (out.length < max) {
    month = financialMonth(addDays(month.start, -1), startDay);
    if (month.start < firstDataDate) break;
    out.unshift(month);
  }
  return out;
}

export type Average = { kind: "average"; value: Piasters } | { kind: "not-enough-history"; fullMonths: number };

/** N2. `monthlyValues` are full months, oldest first, current month excluded. Under 2 months there is no figure. */
export function trailingAverage(monthlyValues: Piasters[]): Average {
  const last = monthlyValues.slice(-AVERAGE_MONTHS);
  if (last.length < MIN_MONTHS) return { kind: "not-enough-history", fullMonths: monthlyValues.length };
  return { kind: "average", value: roundPiasters(last.reduce((s, v) => s + v, 0) / last.length) };
}

type Compared = { kind: "comparison"; current: Piasters; baseline: Piasters };

const earlier = (a: string, b: string) => (a < b ? a : b);

/**
 * N3. Spending so far this month against the average of the SAME day-range of the earlier full months (oldest first),
 * never against whole months. Once the current month is over it compares whole months.
 */
export function monthToDateComparison(input: {
  txs: Tx[];
  currentMonth: Range;
  today: string;
  earlierMonths: Range[];
}): Compared | { kind: "not-enough-history"; fullMonths: number } {
  const { txs, currentMonth } = input;
  const through = earlier(input.today, currentMonth.end);
  const days = daysBetween(currentMonth.start, through) + 1;
  const spendingIn = (from: string, to: string) => periodSummary(filterByDateRange(txs, from, to)).spending;
  const baseline = trailingAverage(
    input.earlierMonths.map((m) => spendingIn(m.start, earlier(addDays(m.start, days - 1), m.end))),
  );
  if (baseline.kind === "not-enough-history") return baseline;
  return { kind: "comparison", current: spendingIn(currentMonth.start, through), baseline: baseline.value };
}

export type Change = { absolute: Piasters; percent: number | null; isNotable: boolean };

/**
 * N4. `percent` is null when the baseline is 0 (any rise from nothing counts as over the percent bar).
 * Notable only if BOTH the percent and the amount bars are reached.
 */
export function change(input: {
  current: Piasters;
  baseline: Piasters;
  thresholds: { percent: number; amount: Piasters };
}): Change {
  const { current, baseline, thresholds } = input;
  const absolute = current - baseline;
  const percent = baseline === 0 ? null : absolute / Math.abs(baseline);
  const overPercent = percent === null ? absolute !== 0 : Math.abs(percent) >= thresholds.percent;
  return { absolute, percent, isNotable: overPercent && Math.abs(absolute) >= thresholds.amount };
}

/**
 * Spending so far this calendar year against the same date range last year. Needs data back to the start of last
 * year, otherwise last year's figure would be a partial one.
 */
export function yearOverYear(input: {
  txs: Tx[];
  today: string;
  firstDataDate: string | null;
}): Compared | { kind: "not-enough-history" } {
  const { txs, today, firstDataDate } = input;
  const year = Number(today.slice(0, 4));
  const lastStart = `${year - 1}-01-01`;
  if (firstDataDate === null || firstDataDate > lastStart) return { kind: "not-enough-history" };
  const spendingIn = (from: string, to: string) => periodSummary(filterByDateRange(txs, from, to)).spending;
  return {
    kind: "comparison",
    current: spendingIn(`${year}-01-01`, today),
    baseline: spendingIn(lastStart, dateOn(year - 1, Number(today.slice(5, 7)), Number(today.slice(8, 10)))),
  };
}
