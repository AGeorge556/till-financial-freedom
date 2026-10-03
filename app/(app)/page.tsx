import Link from "next/link";
import type { ReactNode } from "react";
import { AccountList } from "@/components/AccountList";
import { Amount } from "@/components/Amount";
import { formatRange } from "@/components/dates";
import { EmptyState } from "@/components/EmptyState";
import { GoalCard } from "@/components/GoalCard";
import { GoalPlanCard } from "@/components/GoalPlanCard";
import { card } from "@/components/ui";
import { accountBalances, getSettings, listAccounts, listTransactions, toLedgerTx } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { filterByDateRange, netWorth, periodSummary } from "@/lib/finance-core/ledger";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { loadGoalData } from "./goals/data";

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tracking-tight">{children}</dd>
    </div>
  );
}

export default async function Home() {
  const userId = await requireUserId();
  const [accounts, txRows, settings] = await Promise.all([
    listAccounts(userId, { includeArchived: true }),
    listTransactions(userId),
    getSettings(userId),
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
  const investments = sumOf(true);
  // Archived accounts still hold money, so they stay in net worth; only the list below hides them.
  const total = netWorth({ cash, holdings: investments, liabilities: 0 });
  const archivedCount = accounts.filter((a) => a.archivedAt).length;

  const today = cairoToday();
  const { start, end } = financialMonth(today, settings.monthStartDay);
  const month = periodSummary(filterByDateRange(txRows.map(toLedgerTx), start, end));
  const percent = month.savingsRate === null ? null : Math.round(month.savingsRate * 100);
  const rate = percent === null ? "—" : `${percent < 0 ? "−" : ""}${Math.abs(percent)}%`;

  const goalData = await loadGoalData(userId, { accounts, txRows, monthStartDay: settings.monthStartDay });
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
            </dd>
          </div>
        </dl>
      </div>

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
        </dl>
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
              .map((a) => ({ ...a, balance: balances.get(a.id) ?? 0 }))}
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
