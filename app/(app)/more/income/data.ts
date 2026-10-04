import "server-only";
import { getSettings, listAccounts, listCategories, listTransactions, toAnalyticsTx } from "@/db/queries";
import {
  change,
  DEFAULT_NOTABLE_AMOUNT,
  DEFAULT_NOTABLE_PERCENT,
  fullMonths,
  incomeByCategory,
  monthTotals,
  trailingAverage,
} from "@/lib/finance-core/analytics";
import { filterByDateRange, periodSummary } from "@/lib/finance-core/ledger";
import { addDays } from "@/lib/finance-core/recurring";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { firstPostedDate, toListRow } from "../../spending/data";
import { pickMonth } from "../../spending/MonthNav";
import { syncRecurring } from "../recurring/sync";

const INCOME_TYPES = ["INCOME", "DIVIDEND", "INTEREST"];
const thresholds = { percent: DEFAULT_NOTABLE_PERCENT, amount: DEFAULT_NOTABLE_AMOUNT };

export async function loadIncome(userId: string, requested: string | string[] | undefined) {
  await syncRecurring(userId);
  const today = cairoToday();
  const [settings, accounts, categories, allRows] = await Promise.all([
    getSettings(userId),
    listAccounts(userId, { includeArchived: true }),
    listCategories(userId, { includeArchived: true }),
    listTransactions(userId),
  ]);
  const startDay = settings.monthStartDay;
  const current = financialMonth(today, startDay).start.slice(0, 7);
  const picked = pickMonth(requested, current);
  // A month that has not started has nothing to show and no full months before it.
  const month = picked > current ? current : picked;
  const range = financialMonth(`${month}-${String(startDay).padStart(2, "0")}`, startDay);
  const isCurrent = month === current;

  const analytics = allRows.map(toAnalyticsTx);
  const firstDate = firstPostedDate(allRows);
  const inMonth = analytics.filter((t) => t.date >= range.start && t.date <= range.end);
  const summary = periodSummary(inMonth);

  const average = trailingAverage(monthTotals(analytics, fullMonths(firstDate, range.start, startDay, 3)).map((m) => m.income));

  // The two latest complete months up to the one shown: the month itself once it is over, otherwise the two before it.
  const pair = monthTotals(analytics, fullMonths(firstDate, isCurrent ? range.start : addDays(range.end, 1), startDay, 2));
  const growth =
    pair.length === 2
      ? { earlier: pair[0], later: pair[1], change: change({ current: pair[1].income, baseline: pair[0].income, thresholds }) }
      : null;

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const year = today.slice(0, 4);

  return {
    today,
    startDay,
    month,
    current,
    range,
    isCurrent,
    accounts,
    categories,
    hasIncome: periodSummary(analytics).totalIncome > 0,
    earned: summary.earnedIncome,
    investment: summary.investmentIncome,
    total: summary.totalIncome,
    average,
    year: { label: year, income: periodSummary(filterByDateRange(analytics, `${year}-01-01`, today)).totalIncome },
    growth,
    bySource: incomeByCategory(inMonth).map((g) => ({
      key: g.key,
      total: g.total,
      share: g.share,
      name: g.key === null ? "No category" : (categoryName.get(g.key) ?? "Unknown"),
    })),
    rows: allRows.filter((r) => r.date >= range.start && r.date <= range.end && INCOME_TYPES.includes(r.type)).map((r) => toListRow(r, accountName, categoryName)),
  };
}
