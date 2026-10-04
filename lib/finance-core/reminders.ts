import type { BudgetStatus } from "./budget";
import { type PendingRecurring, pendingSentence, type TextPart } from "./insights";
import type { Piasters } from "./money";
import { daysBetween } from "./recurring";

/**
 * In-app reminders, worked out on every load (no push). Each is a sentence (amounts as parts, so privacy mode hides them)
 * and a link. Each kind has its own switch in settings.
 */
export type ReminderKind = "review" | "recurring" | "stale" | "goal" | "budget" | "savings";

export type Reminder = { id: string; kind: ReminderKind; text: TextPart[]; href: string };

export type ReminderSwitches = Record<ReminderKind, boolean>;

/** The review reminder lasts for the first this-many days of a financial month. */
export const REVIEW_DAYS = 7;
/** A goal contribution is due once the financial month is past this day (day 21 onwards). */
export const GOAL_DUE_AFTER_DAY = 20;

export type ReminderInput = {
  /** The current financial month. */
  month: { start: string; end: string };
  /** There is a finished financial month with data before this one. */
  previousMonthHasData: boolean;
  pendingRecurring: PendingRecurring;
  /** Investment or cloud values older than their stale limit. */
  staleCount: number;
  /** Active goals: planned and actually set aside this month. */
  goals: { id: string; name: string; planned: Piasters; actual: Piasters }[];
  budgets: { id: string; name: string; status: Pick<BudgetStatus, "level" | "spent" | "budget" | "percentUsed"> }[];
  /** Last full month's saving against the monthly target; null when there is no target or no full month. */
  lastMonthSavings: { saved: Piasters; target: Piasters } | null;
};

const txt = (text: string): TextPart => ({ text });
const amt = (amount: Piasters): TextPart => ({ amount });
const items = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildReminders(input: ReminderInput, switches: ReminderSwitches, today: string): Reminder[] {
  const out: Reminder[] = [];
  const dayOfMonth = daysBetween(input.month.start, today) + 1;

  if (switches.review && input.previousMonthHasData && dayOfMonth >= 1 && dayOfMonth <= REVIEW_DAYS) {
    out.push({ id: "review", kind: "review", text: [txt("Last month's review is ready to read.")], href: "/more/review" });
  }

  if (switches.recurring && input.pendingRecurring.count > 0) {
    out.push({ id: "recurring", kind: "recurring", text: pendingSentence(input.pendingRecurring), href: "/more/recurring" });
  }

  if (switches.stale && input.staleCount > 0) {
    out.push({
      id: "stale",
      kind: "stale",
      text: [txt(`${items(input.staleCount, "investment value is", "investment values are")} out of date. Update the prices to keep your net worth accurate.`)],
      href: "/investments",
    });
  }

  if (switches.goal && dayOfMonth > GOAL_DUE_AFTER_DAY) {
    for (const g of input.goals) {
      if (g.planned > g.actual) {
        out.push({
          id: `goal:${g.id}`,
          kind: "goal",
          text: [txt(`${g.name}: you planned to set aside `), amt(g.planned), txt(" this month and have set aside "), amt(g.actual), txt(".")],
          href: `/goals/${g.id}`,
        });
      }
    }
  }

  if (switches.budget) {
    for (const b of input.budgets) {
      const { level, spent, budget, percentUsed } = b.status;
      if (level === "ok") continue;
      out.push({
        id: `budget:${b.id}`,
        kind: "budget",
        text:
          level === "over"
            ? [txt(`${b.name} is `), amt(spent - budget), txt(" over budget this month.")]
            : [txt(`${b.name}: ${Math.round(percentUsed * 100)}% of the budget is used (`), amt(spent), txt(" of "), amt(budget), txt(").")],
        href: "/more/budgets",
      });
    }
  }

  const s = input.lastMonthSavings;
  if (switches.savings && s !== null && s.target > 0 && s.saved < s.target) {
    out.push({
      id: "savings",
      kind: "savings",
      text: [txt("Last month you saved "), amt(s.saved), txt(", below your target of "), amt(s.target), txt(".")],
      href: "/goals/plan",
    });
  }

  return out;
}
