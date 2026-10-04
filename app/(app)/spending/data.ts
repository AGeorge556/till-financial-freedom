import "server-only";
import type { ListRow } from "@/components/TransactionList";
import {
  getBudgetThresholds,
  getInsightThresholds,
  getSettings,
  type HoldingRow,
  listAccounts,
  listBudgets,
  listCategories,
  listHoldings,
  listPendingRecurring,
  listTransactions,
  loadMonth,
  type MonthData,
  toAnalyticsTx,
  type TransactionRow,
} from "@/db/queries";
import {
  change,
  type Change,
  DEFAULT_NOTABLE_AMOUNT,
  DEFAULT_NOTABLE_PERCENT,
  fullMonths,
  monthToDateComparison,
  spendingBy,
  yearOverYear,
} from "@/lib/finance-core/analytics";
import { type BudgetStatus, budgetStatus } from "@/lib/finance-core/budget";
import { filterByDateRange, periodSummary } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import { upcomingInMonth } from "@/lib/finance-core/recurring";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { syncRecurring } from "../more/recurring/sync";
import { pickMonth } from "./MonthNav";

type Range = { start: string; end: string };
export type AnalyticsTx = ReturnType<typeof toAnalyticsTx>;

export type BudgetLine = { id: string; categoryId: string | null; name: string; status: BudgetStatus };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** The overall budget first, then category budgets by name; each worked out for the month in `month`. */
export async function loadBudgetLines(
  userId: string,
  month: MonthData,
  today: string,
  categoryName: Map<string, string>,
): Promise<{ lines: BudgetLine[]; warnAt: number; alertAt: number }> {
  const [rows, { warnAt, alertAt }] = await Promise.all([listBudgets(userId), getBudgetThresholds(userId)]);
  const expenses = month.txs.filter((t) => t.type === "EXPENSE").map(toAnalyticsTx);
  const upcoming = upcomingInMonth(month.templates, month.occurrences, month.range, today).filter((u) => u.type === "EXPENSE");
  const lines = rows.map((b): BudgetLine => {
    const scoped = b.categoryId ? expenses.filter((t) => t.categoryId === b.categoryId) : expenses;
    const due = b.categoryId ? upcoming.filter((u) => u.categoryId === b.categoryId) : upcoming;
    return {
      id: b.id,
      categoryId: b.categoryId,
      name: b.categoryId ? (categoryName.get(b.categoryId) ?? "A category") : "Everything you spend",
      status: budgetStatus({
        budget: b.amount,
        expenses: scoped,
        upcomingFixed: sum(due.map((u) => u.amount)),
        monthRange: month.range,
        today,
        warnAt,
        alertAt,
      }),
    };
  });
  lines.sort((a, b) => Number(b.categoryId === null) - Number(a.categoryId === null) || a.name.localeCompare(b.name));
  return { lines, warnAt, alertAt };
}

export type SpendingComparison =
  | { kind: "not-enough-history" }
  | { kind: "comparison"; current: Piasters; baseline: Piasters; months: number; change: Change };

const defaultThresholds = { percent: DEFAULT_NOTABLE_PERCENT, amount: DEFAULT_NOTABLE_AMOUNT };

/** Spending in `range` (so far, if it is the current month) against the same days of the last 3 full months before it. */
export function compareSpending(
  txs: AnalyticsTx[],
  range: Range,
  today: string,
  startDay: number,
  firstDate: string | null,
  thresholds = defaultThresholds,
): SpendingComparison {
  const earlier = fullMonths(firstDate, range.start, startDay, 3);
  const result = monthToDateComparison({ txs, currentMonth: range, today, earlierMonths: earlier });
  if (result.kind === "not-enough-history") return { kind: "not-enough-history" };
  return { ...result, months: earlier.length, change: change({ current: result.current, baseline: result.baseline, thresholds }) };
}

export const firstPostedDate = (rows: TransactionRow[]): string | null =>
  rows.reduce<string | null>((min, r) => (r.status !== "posted" || (min !== null && min <= r.date) ? min : r.date), null);

export type Share = { key: string | null; name: string; total: Piasters };

/** What a row needs to open the sheet of its own kind: its holding, and for a loan payment both of its rows as one. */
export type ListContext = { holdings: Map<string, NonNullable<ListRow["holding"]>>; payments: Map<string, NonNullable<ListRow["payment"]>> };

/**
 * The two rows of a loan payment share loan, date, account, stamp and status; a removed pair also shares its voided_at,
 * which separates an old version from the one that replaced it (an edit keeps the stamp when the date is unchanged).
 */
export function listContext(holdingRows: HoldingRow[], rows: TransactionRow[]): ListContext {
  const holdings = new Map(
    holdingRows.map((h) => [h.id, { id: h.id, name: h.name, ticker: h.ticker, kind: h.kind, accountId: h.accountId }]),
  );
  const key = (r: TransactionRow) =>
    `${r.liabilityId}|${r.date}|${r.fromAccountId}|${r.createdAt.getTime()}|${r.status}|${r.voidedAt?.getTime() ?? ""}`;
  const pairs = new Map<string, NonNullable<ListRow["payment"]>>();
  for (const r of rows) {
    if (r.liabilityId === null) continue;
    const pair = pairs.get(key(r)) ?? { principal: 0, interest: 0, categoryId: null };
    if (r.type === "LIABILITY_PAYMENT") pair.principal = r.amount;
    else {
      pair.interest = r.amount;
      pair.categoryId = r.categoryId;
    }
    pairs.set(key(r), pair);
  }
  const payments = new Map<string, NonNullable<ListRow["payment"]>>();
  for (const r of rows) {
    const pair = r.liabilityId === null ? undefined : pairs.get(key(r));
    if (pair) payments.set(r.id, pair);
  }
  return { holdings, payments };
}

export function toListRow(
  r: TransactionRow,
  accountName: Map<string, string>,
  categoryName: Map<string, string>,
  context: ListContext,
): ListRow {
  const from = r.fromAccountId ? accountName.get(r.fromAccountId) : undefined;
  const to = r.toAccountId ? accountName.get(r.toAccountId) : undefined;
  return {
    id: r.id,
    type: r.type,
    date: r.date,
    amount: r.amount,
    status: r.status,
    note: r.note,
    categoryId: r.categoryId,
    fromAccountId: r.fromAccountId,
    toAccountId: r.toAccountId,
    liabilityId: r.liabilityId,
    payment: context.payments.get(r.id) ?? null,
    holding: r.holdingId ? (context.holdings.get(r.holdingId) ?? null) : null,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    fee: r.fee,
    taxWithheld: r.taxWithheld,
    grossAmount: r.grossAmount,
    recurringTemplateId: r.recurringTemplateId,
    category: r.categoryId ? (categoryName.get(r.categoryId) ?? null) : null,
    account: r.type === "TRANSFER" ? `${from ?? "?"} → ${to ?? "?"}` : (from ?? to ?? "?"),
  };
}

export async function loadSpending(userId: string, requested: string | string[] | undefined) {
  await syncRecurring(userId);
  const today = cairoToday();
  const [settings, thresholds, accounts, categories, allRows, pendingRows, holdingRows] = await Promise.all([
    getSettings(userId),
    getInsightThresholds(userId),
    listAccounts(userId, { includeArchived: true }),
    listCategories(userId, { includeArchived: true }),
    listTransactions(userId),
    listPendingRecurring(userId),
    listHoldings(userId, { includeArchived: true }),
  ]);
  const context = listContext(holdingRows, allRows);
  const startDay = settings.monthStartDay;
  const current = financialMonth(today, startDay).start.slice(0, 7);
  // The URL carries only the month a financial month starts in.
  const month = pickMonth(requested, current);
  const range = financialMonth(`${month}-${String(startDay).padStart(2, "0")}`, startDay);

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const monthData = await loadMonth(userId, range);
  const budgets = await loadBudgetLines(userId, monthData, today, categoryName);

  // Pending recurring rows (any month) are listed first, with Confirm and Skip; the day list keeps everything else.
  const rows = monthData.txs
    .filter((r) => !(r.status === "pending" && r.recurringTemplateId !== null))
    .map((r) => toListRow(r, accountName, categoryName, context));
  const pending = pendingRows.map((r) => toListRow(r, accountName, categoryName, context));

  const analytics = allRows.map(toAnalyticsTx);
  const inMonth = analytics.filter((t) => t.date >= range.start && t.date <= range.end);
  const spending = periodSummary(inMonth).spending;
  const share = (key: "category" | "account"): Share[] =>
    spendingBy(inMonth, key).map((g) => ({
      key: g.key,
      total: g.total,
      name:
        g.key === null
          ? key === "category"
            ? "No category"
            : "Unknown account"
          : ((key === "category" ? categoryName : accountName).get(g.key) ?? "Unknown"),
    }));

  const firstDate = firstPostedDate(allRows);
  const comparison = compareSpending(analytics, range, today, startDay, firstDate, thresholds);
  // Only categories whose change clears both the percent and the amount bar are worth a line (N4).
  const notable =
    comparison.kind === "comparison"
      ? spendingBy(inMonth, "category")
          .flatMap((g) => {
            const c = compareSpending(
              analytics.filter((t) => (t.categoryId ?? null) === g.key),
              range,
              today,
              startDay,
              firstDate,
              thresholds,
            );
            return c.kind === "comparison" && c.change.isNotable
              ? [
                  {
                    name: g.key === null ? "No category" : (categoryName.get(g.key) ?? "Unknown"),
                    current: c.current,
                    baseline: c.baseline,
                    change: c.change,
                  },
                ]
              : [];
          })
          .sort((a, b) => Math.abs(b.change.absolute) - Math.abs(a.change.absolute))
          .slice(0, 3)
      : [];

  const year = today.slice(0, 4);
  const yoy = yearOverYear({ txs: analytics, today, firstDataDate: firstDate });
  return {
    today,
    startDay,
    month,
    current,
    range,
    isCurrent: month === current,
    accounts,
    categories,
    rows,
    pending,
    spending,
    budgets,
    byCategory: share("category"),
    byAccount: share("account"),
    comparison,
    notable,
    year: {
      spent: periodSummary(filterByDateRange(analytics, `${year}-01-01`, today)).spending,
      comparison:
        yoy.kind === "comparison" ? { ...yoy, change: change({ current: yoy.current, baseline: yoy.baseline, thresholds }) } : null,
    },
  };
}
