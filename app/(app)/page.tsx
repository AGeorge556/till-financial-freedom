import Link from "next/link";
import type { ReactNode } from "react";
import { Amount } from "@/components/Amount";
import { BudgetSummary } from "@/components/BudgetParts";
import { MixChart } from "@/components/charts/MixChart";
import { formatRange } from "@/components/dates";
import { EmptyState } from "@/components/EmptyState";
import { GoalCard } from "@/components/GoalCard";
import { GoalPlanCard } from "@/components/GoalPlanCard";
import { InsightList } from "@/components/InsightList";
import { ReminderList } from "@/components/ReminderList";
import { card } from "@/components/ui";
import {
  accountBalances,
  classValues,
  getReminderSwitches,
  getSettings,
  listAccounts,
  listTransactions,
  loadInsightInput,
  loadMonth,
  loadReminderInput,
  toLedgerTx,
  listCategories,
} from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { buildInsights, topN } from "@/lib/finance-core/insights";
import { filterByDateRange, netWorth, periodSummary } from "@/lib/finance-core/ledger";
import { mix } from "@/lib/finance-core/portfolioMix";
import { buildReminders } from "@/lib/finance-core/reminders";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { loadGoalData } from "./goals/data";
import { loadInvestments } from "./investments/data";
import { syncRecurring } from "./more/recurring/sync";
import { loadBudgetLines } from "./spending/data";

const MAX_INSIGHTS = 5;
const block = "mb-6 break-inside-avoid";
const linkBtn = "inline-flex min-h-11 items-center text-sm underline";

function Stat({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tracking-tight">{children}</dd>
    </div>
  );
}

export default async function Home() {
  const userId = await requireUserId();
  await syncRecurring(userId);
  const today = cairoToday();
  const [accounts, txRows, settings, inv] = await Promise.all([
    listAccounts(userId, { includeArchived: true }),
    listTransactions(userId),
    getSettings(userId),
    loadInvestments(userId, today),
  ]);

  if (accounts.length === 0) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        <div className="mt-8">
          <EmptyState accent="cash" title="Nothing tracked yet" items={["Net worth", "This month", "Accounts"]}>
            Start by adding the places your money lives.{" "}
            <Link href="/more/accounts" className="underline">
              Add an account
            </Link>
            .
          </EmptyState>
        </div>
      </>
    );
  }

  // Same split as the net worth history: cash is every account that is not a credit card (archived ones still hold money),
  // debt is loans plus any credit card you owe on.
  const { values, cardDebt } = classValues(inv.wealth, accounts, accountBalances(accounts, txRows));
  const investments = values.stocks + values.gold + values.clouds;
  const debt = inv.wealth.liabilitiesTotal + cardDebt;
  const total = netWorth({ cash: values.cash, holdings: investments, liabilities: debt });
  const hasHoldings = inv.views.some((v) => !v.row.archivedAt) || inv.clouds.some((c) => !c.row.archivedAt);

  const { start, end } = financialMonth(today, settings.monthStartDay);
  const month = periodSummary(filterByDateRange(txRows.map(toLedgerTx), start, end));
  const percent = month.savingsRate === null ? null : Math.round(month.savingsRate * 100);

  const monthData = await loadMonth(userId, { start, end });
  const categoryNames = new Map((await listCategories(userId, { includeArchived: true })).map((c) => [c.id, c.name]));
  const budgetLines = (await loadBudgetLines(userId, monthData, today, categoryNames)).lines;
  const overallBudget = budgetLines.find((l) => l.categoryId === null);
  const watched = budgetLines.filter((l) => l.categoryId !== null && l.status.level !== "ok").length;

  const goalData = await loadGoalData(userId, { accounts, txRows, monthStartDay: settings.monthStartDay, wealth: inv.wealth });
  const activeGoals = goalData.goals.filter((v) => !v.goal.archivedAt);
  const fundedRules = goalData.rules.filter((r) => r.outcome);
  const savingsTarget = goalData.plan.target;

  const ctx = { goalData, budgets: budgetLines, accounts, txRows, wealth: inv.wealth };
  const [insightInput, reminderInput, switches] = await Promise.all([
    loadInsightInput(userId, ctx),
    loadReminderInput(userId, ctx),
    getReminderSwitches(userId),
  ]);
  const insights = topN(buildInsights(insightInput), MAX_INSIGHTS);
  const reminders = buildReminders(reminderInput, switches, today);

  return (
    <div className="md:relative md:left-1/2 md:w-[clamp(100%,calc(100vw_-_18rem),60rem)] md:-translate-x-1/2">
      <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
      <div className="mt-8 md:columns-2 md:gap-6">
        <section className={block}>
          <p className="text-sm text-muted">Net worth</p>
          <Amount value={total} className="mt-1 block text-4xl font-semibold tracking-tight md:text-3xl lg:text-4xl" />
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div className="border-l-2 border-cash pl-3">
              <dt className="text-sm text-muted">Cash</dt>
              <dd className="font-medium">
                <Amount value={values.cash} />
              </dd>
            </div>
            <div className="border-l-2 border-investments pl-3">
              <dt className="text-sm text-muted">Investments</dt>
              <dd className="font-medium">
                <Amount value={investments} />
              </dd>
            </div>
            <div className="border-l-2 border-negative pl-3">
              <dt className="text-sm text-muted">Debt</dt>
              <dd className="font-medium">
                <Amount value={debt} />
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted">Net worth = cash + investments − debt.</p>
          {inv.stale && (
            <p className="mt-2 text-sm text-negative">
              ▲ Out of date: {inv.staleKinds.join(", ")}. Net worth includes values that may no longer be right.{" "}
              <Link href="/investments" className="underline">
                Update them
              </Link>
            </p>
          )}
          <p className="mt-1 flex flex-wrap gap-x-5">
            <Link href="/more/history" className={linkBtn}>
              Net worth history
            </Link>
            <Link href="/more/accounts" className={linkBtn}>
              Accounts
            </Link>
            {debt > 0 && (
              <Link href="/more/liabilities" className={linkBtn}>
                Loans
              </Link>
            )}
          </p>
        </section>

        <section className={`${block} p-5 ${card}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">This month</h2>
            <p className="text-sm text-muted">{formatRange(start, end)}</p>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
            <Stat label="Income">
              <Amount value={month.totalIncome} />
            </Stat>
            <Stat label="Spending">
              <Amount value={month.spending} />
            </Stat>
            <Stat label="Saved">
              <Amount value={month.savings} className={month.savings < 0 ? "text-negative" : ""} />
              {percent !== null && <span className="block text-sm font-normal text-muted">{percent}% of income</span>}
            </Stat>
            <Stat label="Invested">
              <Amount value={month.invested} />
              <span className="block text-sm font-normal text-muted">
                Bought minus sold <Amount value={month.netInvested} />
              </span>
            </Stat>
          </dl>
          {savingsTarget > 0 && (
            <p className="mt-4 border-t border-border pt-4 text-sm">
              Savings target: saved <Amount value={month.savings} /> of <Amount value={savingsTarget} /> planned.
            </p>
          )}
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm text-muted">Monthly budget</h3>
              <Link href={overallBudget ? "/spending" : "/more/budgets"} className={linkBtn}>
                {overallBudget ? "Details" : "Set a budget"}
              </Link>
            </div>
            {overallBudget ? (
              <BudgetSummary status={overallBudget.status} />
            ) : (
              <p className="text-sm text-muted">No overall budget set.</p>
            )}
            {watched > 0 && (
              <p className="mt-2 text-sm text-spending">
                ▲ {watched} category {watched === 1 ? "budget is" : "budgets are"} close to or over the limit.
              </p>
            )}
          </div>
        </section>

        {reminders.length > 0 && (
          <div className={block}>
            <ReminderList reminders={reminders} />
          </div>
        )}

        <section className={block}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Goals</h2>
            <Link href="/goals" className={linkBtn}>
              {activeGoals.length > 4 ? `All ${activeGoals.length} goals` : "All goals"}
            </Link>
          </div>
          {activeGoals.length === 0 ? (
            <p className="text-muted">
              No goals yet.{" "}
              <Link href="/goals" className="underline">
                Add a goal
              </Link>{" "}
              to see how much to save each month.
            </p>
          ) : (
            <ul className="grid gap-3">
              {activeGoals.slice(0, 4).map((v) => (
                <li key={v.goal.id}>
                  <GoalCard view={v} compact />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${block} p-5 ${card}`}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Portfolio</h2>
            <Link href="/investments" className={linkBtn}>
              {hasHoldings ? "Open" : "Add a holding"}
            </Link>
          </div>
          <MixChart mix={mix(values)} />
          {hasHoldings && <p className="mt-3 text-sm text-muted">Savings Clouds are estimated from the yearly rate you entered.</p>}
        </section>

        <section className={block}>
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Financial insights</h2>
          <InsightList insights={insights} />
        </section>

        <div className={block}>
          <GoalPlanCard
            planned={goalData.totals.planned}
            actual={goalData.totals.actual}
            hasRules={fundedRules.length > 0}
            shortfall={goalData.plan.shortfallTotal}
          />
        </div>
      </div>
    </div>
  );
}
