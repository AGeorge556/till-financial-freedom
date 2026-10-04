import { change, monthToDateComparison, trailingAverage, type CategorizedTx } from "./analytics";
import type { BudgetStatus } from "./budget";
import type { Piasters } from "./money";
import type { Mix } from "./portfolioMix";

/**
 * Insights are data, not sentences: the UI renders `text` (amounts through the Amount component, so privacy mode hides
 * them) and, when tapped, `inputs` and `formula`. "Average" means the last 3 FULL financial months, the current one
 * excluded. A comparison needs at least 2 full months; the kinds that compare nothing against history (budget state,
 * goal status, allocation share, stale values, pending items) work from day one.
 */
export type InsightKind =
  | "spending-vs-average"
  | "category-spending"
  | "savings-vs-target"
  | "goal-late"
  | "goal-early"
  | "goals-on-track"
  | "investment-share"
  | "cash-up-investing-down"
  | "budget"
  | "stale-values"
  | "pending-recurring";

export type TextPart = { text: string } | { amount: Piasters };

export type InsightInputValue = { label: string; value: number; unit: "egp" | "percent" | "months" | "days" | "count" };

export type Insight = {
  /** Stable, so a dismissed or expanded insight keeps its identity between loads. */
  id: string;
  kind: InsightKind;
  severity: "good" | "info" | "warning";
  /** EGP at stake, in piasters: only used to rank. 0 for the purely informational ones. */
  impact: Piasters;
  text: TextPart[];
  /** Percentages are decimals (0.15 = 15%). */
  inputs: InsightInputValue[];
  /** Plain-text account of how the figure was calculated. */
  formula: string;
};

type Range = { start: string; end: string };

export type InsightInput = {
  today: string;
  /** From settings: a spending change must reach BOTH. */
  thresholds: { percent: number; amount: Piasters };
  spending: {
    /** Expense rows (any status; only posted ones count) of the current month and the earlier full months. */
    txs: CategorizedTx[];
    currentMonth: Range;
    /** The last full months before the current one, oldest first (analytics.fullMonths). */
    earlierMonths: Range[];
    categoryNames: Record<string, string>;
  };
  /** Full financial months, oldest first, newest last (at most 4). */
  months: { saved: Piasters; cashChange: Piasters; invested: Piasters }[];
  /** The monthly savings target; null or 0 = none. */
  savingsTarget: Piasters | null;
  /** Active goals, as goals.goalProjection gives them. */
  goals: { id: string; name: string; onTrack: boolean; monthsLate: number | null; gap: Piasters }[];
  mix: Mix;
  budgets: { id: string; name: string; status: Pick<BudgetStatus, "level" | "budget" | "spent" | "percentUsed" | "projected"> }[];
  /** Stale investment values: how many, and what they are worth. */
  stale: { count: number; value: Piasters };
  /** Recurring items waiting for confirmation. */
  pending: { count: number; total: Piasters };
};

const amt = (value: Piasters): TextPart => ({ amount: value });
const txt = (text: string): TextPart => ({ text });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const abs = Math.abs;

function spendingChange(input: InsightInput): Insight[] {
  const { spending, thresholds, today } = input;
  const out: Insight[] = [];
  const compare = (txs: CategorizedTx[]) =>
    monthToDateComparison({ txs, currentMonth: spending.currentMonth, today, earlierMonths: spending.earlierMonths });
  const notable = (id: string, kind: "spending-vs-average" | "category-spending", subject: string, txs: CategorizedTx[]) => {
    const cmp = compare(txs);
    if (cmp.kind !== "comparison") return;
    const c = change({ current: cmp.current, baseline: cmp.baseline, thresholds });
    if (!c.isNotable) return;
    const up = c.absolute > 0;
    out.push({
      id,
      kind,
      severity: up ? "warning" : "good",
      impact: abs(c.absolute),
      text: [
        txt(`${subject} so far this month is `),
        amt(cmp.current),
        txt(", "),
        amt(abs(c.absolute)),
        txt(` ${up ? "more" : "less"} than usual for these days of the month (`),
        amt(cmp.baseline),
        txt(")."),
      ],
      inputs: [
        { label: "Spent so far this month", value: cmp.current, unit: "egp" },
        { label: `Usual for the same days (average of ${spending.earlierMonths.slice(-3).length} full months)`, value: cmp.baseline, unit: "egp" },
        { label: "Difference", value: c.absolute, unit: "egp" },
        ...(c.percent === null ? [] : [{ label: "Change", value: c.percent, unit: "percent" as const }]),
        { label: "Smallest change shown (percent)", value: thresholds.percent, unit: "percent" },
        { label: "Smallest change shown (amount)", value: thresholds.amount, unit: "egp" },
      ],
      formula:
        `Spending so far this month is compared with the average of the same days (day 1 to today's day) in the last ${spending.earlierMonths.slice(-3).length} full months, never with whole months. ` +
        "It is shown only when the change reaches both smallest-change bars from your settings (percent and amount).",
    });
  };

  notable("spending-vs-average", "spending-vs-average", "Your spending", spending.txs);
  const ids = [...new Set(spending.txs.map((t) => t.categoryId).filter((c): c is string => !!c))].sort();
  for (const id of ids) {
    notable(`category-spending:${id}`, "category-spending", `Spending on ${spending.categoryNames[id] ?? "one category"}`, spending.txs.filter((t) => t.categoryId === id));
  }
  return out;
}

function savingsVsTarget(input: InsightInput): Insight[] {
  const { months, savingsTarget, thresholds } = input;
  if (months.length < 2 || !savingsTarget || savingsTarget <= 0) return [];
  const saved = months[months.length - 1].saved;
  const c = change({ current: saved, baseline: savingsTarget, thresholds });
  if (!c.isNotable) return [];
  const below = c.absolute < 0;
  return [
    {
      id: "savings-vs-target",
      kind: "savings-vs-target",
      severity: below ? "warning" : "good",
      impact: abs(c.absolute),
      text: [txt("Last month you saved "), amt(saved), txt(", "), amt(abs(c.absolute)), txt(` ${below ? "below" : "above"} your target of `), amt(savingsTarget), txt(".")],
      inputs: [
        { label: "Saved last month", value: saved, unit: "egp" },
        { label: "Savings target", value: savingsTarget, unit: "egp" },
        { label: "Difference", value: c.absolute, unit: "egp" },
        { label: "Smallest change shown (percent)", value: thresholds.percent, unit: "percent" },
        { label: "Smallest change shown (amount)", value: thresholds.amount, unit: "egp" },
      ],
      formula: "Saved = income - spending in the last full month. It is compared with your monthly savings target, and shown only when the gap passes the same two bars as a spending change.",
    },
  ];
}

function goalInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  for (const g of input.goals) {
    const base = { label: "Short of target at target date", value: Math.max(0, -g.gap), unit: "egp" as const };
    if (g.monthsLate === null) {
      out.push({
        id: `goal-late:${g.id}`,
        kind: "goal-late",
        severity: "warning",
        impact: Math.max(0, -g.gap),
        text: [txt(`${g.name} will not be reached with the amount you plan to set aside; it would be short by `), amt(Math.max(0, -g.gap)), txt(" at its date.")],
        inputs: [base],
        formula: "Your planned monthly amount and the assumed return are projected forward month by month; the target is not reached within 100 years.",
      });
    } else if (g.monthsLate > 0) {
      out.push({
        id: `goal-late:${g.id}`,
        kind: "goal-late",
        severity: "warning",
        impact: Math.max(0, -g.gap),
        text: [txt(`${g.name} is projected to be ${plural(g.monthsLate, "month", "months")} late, short by `), amt(Math.max(0, -g.gap)), txt(" at its date.")],
        inputs: [{ label: "Months late", value: g.monthsLate, unit: "months" }, base],
        formula: "Months to reach the target at your planned monthly amount and assumed return, minus the months left until the target date.",
      });
    } else if (g.monthsLate < 0) {
      out.push({
        id: `goal-early:${g.id}`,
        kind: "goal-early",
        severity: "good",
        impact: Math.max(0, g.gap),
        text: [txt(`${g.name} is projected to be ${plural(-g.monthsLate, "month", "months")} early, `), amt(Math.max(0, g.gap)), txt(" over its target at its date.")],
        inputs: [{ label: "Months early", value: -g.monthsLate, unit: "months" }, { label: "Over target at target date", value: Math.max(0, g.gap), unit: "egp" }],
        formula: "The months left until the target date, minus the months to reach the target at your planned monthly amount and assumed return.",
      });
    }
  }
  if (input.goals.length > 0 && input.goals.every((g) => g.onTrack)) {
    out.push({
      id: "goals-on-track",
      kind: "goals-on-track",
      severity: "good",
      impact: 0,
      text: [txt(input.goals.length === 1 ? "Your goal is on track." : `All ${input.goals.length} of your goals are on track.`)],
      inputs: [{ label: "Active goals", value: input.goals.length, unit: "count" }],
      formula: "A goal is on track when its projected value at the target date, using your planned monthly amount and assumed return, reaches the target.",
    });
  }
  return out;
}

function investmentShare(input: InsightInput): Insight[] {
  const { mix } = input;
  if (mix.total <= 0) return [];
  const lines = mix.lines.filter((l) => l.class !== "cash");
  const value = lines.reduce((s, l) => s + l.value, 0);
  const bps = lines.reduce((s, l) => s + l.bps, 0);
  return [
    {
      id: "investment-share",
      kind: "investment-share",
      severity: "info",
      impact: 0,
      text: [txt(`Investments are ${bps / 100}% of your total assets (`), amt(value), txt(" of "), amt(mix.total), txt(").")],
      inputs: [
        { label: "Stocks, funds, gold and Savings Clouds", value, unit: "egp" },
        { label: "Total assets", value: mix.total, unit: "egp" },
        { label: "Share", value: bps / 10000, unit: "percent" },
      ],
      formula: "Investments = stocks and funds + gold + Savings Clouds. Total assets = investments + cash. Share = investments / total assets.",
    },
  ];
}

function cashUpInvestingDown(input: InsightInput): Insight[] {
  const { months, thresholds } = input;
  if (months.length < 3) return [];
  const last = months[months.length - 1];
  const avg = trailingAverage(months.slice(0, -1).map((m) => m.invested));
  if (avg.kind !== "average" || last.cashChange <= 0) return [];
  const c = change({ current: last.invested, baseline: avg.value, thresholds });
  if (!c.isNotable || c.absolute >= 0) return [];
  return [
    {
      id: "cash-up-investing-down",
      kind: "cash-up-investing-down",
      severity: "info",
      impact: abs(c.absolute),
      text: [txt("Your cash grew by "), amt(last.cashChange), txt(" last month while you invested "), amt(last.invested), txt(", "), amt(abs(c.absolute)), txt(" less than usual ("), amt(avg.value), txt(").")],
      inputs: [
        { label: "Cash change last month", value: last.cashChange, unit: "egp" },
        { label: "Invested last month", value: last.invested, unit: "egp" },
        { label: "Usual monthly investing", value: avg.value, unit: "egp" },
      ],
      formula: "Invested = purchases minus sales in the last full month. Usual = average of the full months before it (up to 3). Shown when cash rose and investing fell by the same two bars as a spending change.",
    },
  ];
}

function budgetInsights(input: InsightInput): Insight[] {
  return input.budgets.flatMap((b): Insight[] => {
    const { level, budget, spent, percentUsed, projected } = b.status;
    if (level === "ok") return [];
    const over = level === "over";
    const projectedOver = Math.max(0, projected - budget);
    const impact = over ? spent - budget : projectedOver;
    return [
      {
        id: `budget:${b.id}`,
        kind: "budget",
        severity: "warning",
        impact,
        text: over
          ? [txt(`You are `), amt(spent - budget), txt(` over your ${b.name} budget.`)]
          : [txt(`You have used ${Math.round(percentUsed * 100)}% of your ${b.name} budget (`), amt(spent), txt(" of "), amt(budget), txt(").")],
        inputs: [
          { label: "Spent", value: spent, unit: "egp" },
          { label: "Budget", value: budget, unit: "egp" },
          { label: "Share used", value: percentUsed, unit: "percent" },
          { label: "Projected by month end", value: projected, unit: "egp" },
        ],
        formula: "Share used = spent / budget. It warns at your warning level, alerts at your alert level and is 'over' only once spending is above the budget. Ranked by the amount over, or by the projected overshoot.",
      },
    ];
  });
}

function staleValues({ stale }: InsightInput): Insight[] {
  if (stale.count <= 0) return [];
  return [
    {
      id: "stale-values",
      kind: "stale-values",
      severity: "warning",
      impact: stale.value,
      text: [txt(`${plural(stale.count, "investment value is", "investment values are")} out of date, together worth about `), amt(stale.value), txt(". Update the prices to keep your net worth accurate.")],
      inputs: [
        { label: "Out-of-date values", value: stale.count, unit: "count" },
        { label: "Worth", value: stale.value, unit: "egp" },
      ],
      formula: "A value is out of date when its latest price or confirmation is older than the number of days set for it in settings.",
    },
  ];
}

function pendingRecurring({ pending }: InsightInput): Insight[] {
  if (pending.count <= 0) return [];
  return [
    {
      id: "pending-recurring",
      kind: "pending-recurring",
      severity: "info",
      impact: pending.total,
      text: [txt(`${plural(pending.count, "recurring item is", "recurring items are")} waiting for you to confirm, `), amt(pending.total), txt(" in total.")],
      inputs: [
        { label: "Waiting items", value: pending.count, unit: "count" },
        { label: "Total", value: pending.total, unit: "egp" },
      ],
      formula: "Recurring items that have come due and are still pending. Nothing counts toward balances or budgets until you confirm it.",
    },
  ];
}

/** Largest impact first; ties by id so the order never flickers. */
export const rank = (insights: Insight[]): Insight[] => [...insights].sort((a, b) => b.impact - a.impact || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function buildInsights(input: InsightInput): Insight[] {
  return rank([
    ...spendingChange(input),
    ...savingsVsTarget(input),
    ...goalInsights(input),
    ...investmentShare(input),
    ...cashUpInvestingDown(input),
    ...budgetInsights(input),
    ...staleValues(input),
    ...pendingRecurring(input),
  ]);
}

export const topN = (insights: Insight[], n: number): Insight[] => rank(insights).slice(0, Math.max(0, n));
