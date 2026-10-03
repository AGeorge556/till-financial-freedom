import type { Piasters } from "./money";
import type { Tx } from "./ledger";

export type Frequency = "weekly" | "monthly" | "yearly";

export type RecurringTemplate = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: Piasters;
  categoryId: string | null;
  accountId: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  active: boolean;
};

/** A ledger row generated from a template, of any status (a void row is a skipped occurrence and is never regenerated). */
export type RecurringRow = { templateId: string; dueDate: string; status: Tx["status"] };

export type UpcomingItem = {
  templateId: string;
  type: "INCOME" | "EXPENSE";
  amount: Piasters;
  categoryId: string | null;
  accountId: string;
  dueDate: string;
  /** true = a pending row already exists; false = not generated yet. */
  pending: boolean;
};

const DAY_MS = 86_400_000;

function parse(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const utc = (date: string) => {
  const [y, m, d] = parse(date);
  return Date.UTC(y, m - 1, d);
};

export const addDays = (date: string, days: number): string => new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (negative if b is earlier). */
export const daysBetween = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / DAY_MS);

/** The given day of a month (month 1-12), clamped to the month's last day: day 31 in February is the 28th or 29th. */
export function dateOn(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, last))).toISOString().slice(0, 10);
}

/**
 * Every due date from the start date up to `upTo` and the end date, inclusive; none if inactive.
 * Monthly and yearly dates are computed from the start date's day each time, so 31 Jan gives 28 Feb then 31 Mar.
 */
export function dueDates(
  template: Pick<RecurringTemplate, "frequency" | "startDate" | "endDate" | "active">,
  upTo: string,
): string[] {
  if (!template.active) return [];
  const last = template.endDate !== null && template.endDate < upTo ? template.endDate : upTo;
  const [y, m, d] = parse(template.startDate);
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const date =
      template.frequency === "weekly"
        ? addDays(template.startDate, 7 * k)
        : template.frequency === "monthly"
          ? dateOn(y + Math.floor((m - 1 + k) / 12), ((m - 1 + k) % 12) + 1, d)
          : dateOn(y + k, m, d);
    if (date > last) return out;
    out.push(date);
  }
}

/** Due dates up to today with no row of any status for this template: what the lazy generator must create (R3). */
export function missingOccurrences(
  template: Pick<RecurringTemplate, "frequency" | "startDate" | "endDate" | "active">,
  existingDueDates: string[],
  today: string,
): string[] {
  const have = new Set(existingDueDates);
  return dueDates(template, today).filter((d) => !have.has(d));
}

/**
 * Occurrences dated inside the month that still have to be paid or received: pending rows plus ones not generated yet.
 * Posted and skipped (void) occurrences are not here. A month that is already over has none (the projection is the actual).
 */
export function upcomingInMonth(
  templates: RecurringTemplate[],
  existing: RecurringRow[],
  monthRange: { start: string; end: string },
  today: string,
): UpcomingItem[] {
  if (monthRange.end < today) return [];
  const status = new Map(existing.map((r) => [`${r.templateId}|${r.dueDate}`, r.status]));
  const items: UpcomingItem[] = [];
  for (const t of templates) {
    for (const dueDate of dueDates(t, monthRange.end)) {
      const s = status.get(`${t.id}|${dueDate}`);
      if (dueDate >= monthRange.start && (s === undefined || s === "pending")) {
        items.push({
          templateId: t.id,
          type: t.type,
          amount: t.amount,
          categoryId: t.categoryId,
          accountId: t.accountId,
          dueDate,
          pending: s === "pending",
        });
      }
    }
  }
  return items;
}
