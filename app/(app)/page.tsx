import Link from "next/link";
import type { ReactNode } from "react";
import { AccountList } from "@/components/AccountList";
import { Amount } from "@/components/Amount";
import { BudgetSummary } from "@/components/BudgetParts";
import { formatRange } from "@/components/dates";
import { EmptyState } from "@/components/EmptyState";
import { GoalCard } from "@/components/GoalCard";
import { GoalPlanCard } from "@/components/GoalPlanCard";
import { HoldingPL } from "@/components/HoldingPL";
import { card } from "@/components/ui";
import { accountBalances, getSettings, listAccounts, listPendingRecurring, listTransactions, loadMonth, toLedgerTx } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { filterByDateRange, netWorth, periodSummary } from "@/lib/finance-core/ledger";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { loadGoalData } from "./goals/data";
import { holdingsByAccount, loadInvestments } from "./investments/data";
import { syncRecurring } from "./more/recurring/sync";
import { loadBudgetLines } from "./spending/data";

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

  const balances = accountBalances(accounts, txRows);
  const sumOf = (investment: boolean) =>
    accounts.filter((a) => a.isInvestment === investment).reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0);
  const cash = sumOf(false);
  const investmentCash = sumOf(true);
  const investments = netWorth({ cash: investmentCash, holdings: inv.totals.all, liabilities: 0 });
  const loans = inv.wealth.liabilitiesTotal;
  // Archived accounts still hold money, so they stay in net worth; only the list below hides them.
  const total = netWorth({ cash: cash + investmentCash, holdings: inv.totals.all, liabilities: loans });
  const heldIn = holdingsByAccount(inv);
  const hasHoldings = inv.views.some((v) => !v.row.archivedAt) || inv.clouds.some((c) => !c.row.archivedAt);
  const archivedCount = accounts.filter((a) => a.archivedAt).length;

  const { start, end } = financialMonth(today, settings.monthStartDay);
  const month = periodSummary(filterByDateRange(txRows.map(toLedgerTx), start, end));
  const percent = month.savingsRate === null ? null : Math.round(month.savingsRate * 100);
  const rate = percent === null ? "—" : `${percent < 0 ? "−" : ""}${Math.abs(percent)}%`;

  const [monthData, pendingItems] = await Promise.all([loadMonth(userId, { start, end }), listPendingRecurring(userId)]);
  const budgetLines = (await loadBudgetLines(userId, monthData, today, new Map())).lines;
  const overallBudget = budgetLines.find((l) => l.categoryId === null);
  const watched = budgetLines.filter((l) => l.categoryId !== null && l.status.level !== "ok").length;

  const goalData = await loadGoalData(userId, { accounts, txRows, monthStartDay: settings.monthStartDay, wealth: inv.wealth });
  const activeGoals = goalData.goals.filter((v) => !v.goal.archivedAt);
  const fundedRules = goalData.rules.filter((r) => r.outcome);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
      <div className="mt-8">
        <p className="text-sm text-muted">Net worth</p>
        <Amount value={total} className="mt-1 block text-5xl font-semibold tracking-tight" />
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div className="border-l-2 border-cash pl-3">
            <dt className="text-sm text-muted">Everyday accounts</dt>
            <dd className="font-medium">
              <Amount value={cash} />
            </dd>
          </div>
          <div className="border-l-2 border-investments pl-3">
            <dt className="text-sm text-muted">Investments</dt>
            <dd className="font-medium">
              <Amount value={investments} />
              {hasHoldings && (
                <span className="block text-sm font-normal text-muted">
                  Holdings <Amount value={inv.totals.all} /> + cash <Amount value={investmentCash} />
                </span>
              )}
            </dd>
          </div>
          {loans > 0 && (
            <div className="col-span-2 border-l-2 border-negative pl-3">
              <dt className="text-sm text-muted">Loans and money you owe</dt>
              <dd className="font-medium">
                −<Amount value={loans} />
                <Link href="/more/liabilities" className="ml-3 inline-flex min-h-11 items-center text-sm font-normal underline">
                  Open loans
                </Link>
              </dd>
            </div>
          )}
        </dl>
        {(hasHoldings || loans > 0) && (
          <p className="mt-3 text-sm text-muted">Net worth = everyday accounts + investments − loans.</p>
        )}
        {inv.stale && (
          <p className="mt-3 text-sm text-negative">
            ▲ Out of date: {inv.staleKinds.join(", ")}. Net worth includes values that may no longer be right.{" "}
            <Link href="/investments" className="underline">
              Update them
            </Link>
          </p>
        )}
      </div>

      {pendingItems.length > 0 && (
        <p role="status" className={`mt-6 p-4 ${card}`}>
          {pendingItems.length === 1 ? "1 recurring item is" : `${pendingItems.length} recurring items are`} waiting for your OK.{" "}
          <Link href="/spending" className="inline-flex min-h-11 items-center font-medium underline">
            Review in Spending
          </Link>
        </p>
      )}

      <section className={`mt-8 p-5 ${card}`}>
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
          <Stat label="Savings">
            <Amount value={month.savings} className={month.savings < 0 ? "text-negative" : ""} />
          </Stat>
          <Stat label="Savings rate">{rate}</Stat>
          <Stat label="Invested" className="col-span-2">
            <Amount value={month.invested} />
            <span className="mt-0.5 block text-sm font-normal text-muted">
              Net invested (bought minus sold) <Amount value={month.netInvested} />
            </span>
          </Stat>
        </dl>
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-sm text-muted">Monthly budget</h3>
            <Link href={overallBudget ? "/spending" : "/more/budgets"} className="inline-flex min-h-11 items-center text-sm underline">
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

      <section className={`mt-8 p-5 ${card}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Portfolio</h2>
          <Link href="/investments" className="inline-flex min-h-11 items-center text-sm underline">
            {hasHoldings ? "Open" : "Add a holding"}
          </Link>
        </div>
        {!hasHoldings ? (
          <p className="text-muted">No holdings yet.</p>
        ) : (
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-5">
            <Stat label="Stocks & funds">
              <Amount value={inv.totals.stocks} />
            </Stat>
            <Stat label="Gold">
              <Amount value={inv.totals.gold} />
            </Stat>
            <Stat label="Savings Clouds (estimated)">
              <Amount value={inv.totals.clouds} />
            </Stat>
            <Stat label="Cash in investment accounts">
              <Amount value={investmentCash} />
            </Stat>
            <Stat label="Profit or loss on stocks, funds and gold">
              <HoldingPL value={inv.unrealized} />
            </Stat>
            <Stat label="Cloud growth so far (estimated)">
              <HoldingPL value={inv.cloudGrowth} />
            </Stat>
          </dl>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Goals</h2>
          <Link href="/goals" className="inline-flex min-h-11 items-center text-sm underline">
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
          <ul className="grid gap-3 md:grid-cols-2">
            {activeGoals.slice(0, 4).map((v) => (
              <li key={v.goal.id}>
                <GoalCard view={v} compact />
              </li>
            ))}
          </ul>
        )}
      </section>

      <GoalPlanCard
        planned={goalData.totals.planned}
        actual={goalData.totals.actual}
        hasRules={fundedRules.length > 0}
        shortfall={goalData.plan.shortfallTotal}
      />

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Accounts</h2>
        {archivedCount < accounts.length ? (
          <AccountList
            accounts={accounts
              .filter((a) => !a.archivedAt)
              .map((a) => ({ ...a, balance: balances.get(a.id) ?? 0, holdings: a.isInvestment ? (heldIn.get(a.id) ?? 0) : undefined }))}
          />
        ) : (
          <p className="text-muted">All your accounts are archived.</p>
        )}
        {archivedCount > 0 && (
          <p className="mt-2 text-sm text-muted">
            Net worth also counts {archivedCount} archived {archivedCount === 1 ? "account" : "accounts"}.
          </p>
        )}
      </section>
    </>
  );
}
