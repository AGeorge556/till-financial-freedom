import "server-only";
import {
  getSettings,
  listGoals,
  listTransactions,
  loadMonth,
  loadNetWorthSnapshots,
  toAnalyticsTx,
  toLedgerTx,
} from "@/db/queries";
import { change, type Change, DEFAULT_NOTABLE_AMOUNT, DEFAULT_NOTABLE_PERCENT, fullMonths, monthTotals, trailingAverage } from "@/lib/finance-core/analytics";
import { actualContribution } from "@/lib/finance-core/goals";
import type { Piasters } from "@/lib/finance-core/money";
import { addDays } from "@/lib/finance-core/recurring";
import { monthlyReview } from "@/lib/finance-core/review";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { compareSpending, firstPostedDate, type SpendingComparison } from "../../spending/data";
import { pickMonth } from "../../spending/MonthNav";
import { syncRecurring } from "../recurring/sync";

export type Compared = { current: Piasters; baseline: Piasters; change: Change };

const thresholds = { percent: DEFAULT_NOTABLE_PERCENT, amount: DEFAULT_NOTABLE_AMOUNT };

export async function loadReview(userId: string, requested: string | string[] | undefined) {
  await syncRecurring(userId);
  const today = cairoToday();
  const [settings, allRows, goals] = await Promise.all([getSettings(userId), listTransactions(userId), listGoals(userId, { includeArchived: true })]);
  const startDay = settings.monthStartDay;
  const current = financialMonth(today, startDay).start.slice(0, 7);
  const picked = pickMonth(requested, current);
  // A month that has not started has nothing to review.
  const month = picked > current ? current : picked;
  const full = financialMonth(`${month}-${String(startDay).padStart(2, "0")}`, startDay);
  const inProgress = today <= full.end;
  // A month still running is reviewed up to today: net worth is only known as of today, so the same days feed every figure.
  const range = { start: full.start, end: inProgress ? today : full.end };

  const data = await loadMonth(userId, range);
  const [before, after] = await loadNetWorthSnapshots(userId, [addDays(range.start, -1), range.end]);
  const review = monthlyReview({
    range,
    txs: data.txs.map(toLedgerTx),
    netWorthStart: before.netWorth,
    netWorthEnd: after.netWorth,
    holdingsValueStart: before.holdings,
    holdingsValueEnd: after.holdings,
    liabilityUpdates: data.liabilityUpdates.map((u) => ({ date: u.date, delta: u.delta })),
    allocationEvents: data.allocationEvents.map((e) => ({ date: e.date, delta: e.delta })),
  });

  const perGoal = goals
    .map((g) => ({
      id: g.id,
      name: g.name,
      amount: actualContribution(
        data.allocationEvents.filter((e) => e.goalId === g.id).map((e) => ({ date: e.date, delta: e.delta })),
        range,
      ),
    }))
    .filter((g) => g.amount !== 0);

  const firstDate = firstPostedDate(allRows);
  const spending: SpendingComparison = compareSpending(allRows.map(toAnalyticsTx), full, today, startDay, firstDate);
  // Income and saved are compared as whole months only, so they wait until the month is over.
  let others: { income: Compared; saved: Compared } | null = null;
  if (!inProgress) {
    const earlier = fullMonths(firstDate, full.start, startDay, 3);
    const ledger = allRows.map(toLedgerTx);
    const totals = monthTotals(ledger, earlier);
    const [now] = monthTotals(ledger, [full]);
    const against = (key: "income" | "savings", value: Piasters): Compared | null => {
      const avg = trailingAverage(totals.map((t) => t[key]));
      return avg.kind === "average" ? { current: value, baseline: avg.value, change: change({ current: value, baseline: avg.value, thresholds }) } : null;
    };
    const income = against("income", now.income);
    const saved = against("savings", now.savings);
    others = income && saved ? { income, saved } : null;
  }

  return {
    month,
    current,
    startDay,
    full,
    range,
    inProgress,
    review,
    perGoal,
    compare: { spending, others },
  };
}
