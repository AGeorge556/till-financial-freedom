import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { BudgetCard } from "@/components/BudgetParts";
import { RecurringPendingList } from "@/components/RecurringPending";
import { changeWords } from "@/components/ReviewParts";
import { TransactionList } from "@/components/TransactionList";
import { Wide } from "@/components/Wide";
import { requireUserId } from "@/lib/auth";
import type { Piasters } from "@/lib/finance-core/money";
import { loadSpending, type Share } from "./data";
import { MonthNav } from "./MonthNav";

export const metadata: Metadata = { title: "Spending" };

const h2 = "text-lg font-semibold tracking-tight";

function ShareList({ title, items, total }: { title: string; items: Share[]; total: Piasters }) {
  return (
    <div>
      <h3 className="mb-2 font-medium">{title}</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((item) => {
          const pct = total > 0 ? Math.round((item.total / total) * 100) : 0;
          return (
            <li key={item.key ?? "none"} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words">{item.name}</span>
                <span className="shrink-0 font-medium">
                  <Amount value={item.total} /> <span className="text-sm font-normal text-muted">{pct}%</span>
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${item.name} share of spending`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-valuetext={`${pct} percent of this month's spending`}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
              >
                <div className="h-full rounded-full bg-spending" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const userId = await requireUserId();
  const d = await loadSpending(userId, (await searchParams).m);
  const { comparison } = d;
  const period = d.isCurrent ? "So far this month you have spent" : "This month you spent";
  const overall = d.budgets.lines.find((l) => l.categoryId === null);
  const byCategory = d.budgets.lines.filter((l) => l.categoryId !== null);

  return (
    <Wide>
      <h1 className="text-3xl font-semibold tracking-tight">Spending</h1>

      <MonthNav base="/spending" month={d.month} current={d.current} monthStartDay={d.startDay} />

      <div className="mt-6">
        <p className="text-sm text-muted">Total spent</p>
        <Amount value={d.spending} className="mt-1 block text-4xl font-semibold tracking-tight text-spending" />
      </div>

      <RecurringPendingList items={d.pending} />

      <section aria-labelledby="budgets-heading" className="mt-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="budgets-heading" className={h2}>
            Budgets
          </h2>
          <Link href="/more/budgets" className="inline-flex min-h-11 items-center text-sm underline">
            {d.budgets.lines.length === 0 ? "Set a budget" : "Change budgets"}
          </Link>
        </div>
        {d.budgets.lines.length === 0 ? (
          <p className="text-muted">
            You have not set a monthly budget. A budget shows how much is left and where the month is heading.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {overall && (
              <div className="lg:col-span-2">
                <BudgetCard name="Everything you spend" status={overall.status} ongoing={d.isCurrent} />
              </div>
            )}
            {byCategory.map((line) => (
              <BudgetCard key={line.id} name={line.name} status={line.status} ongoing={d.isCurrent} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="breakdown-heading" className="mt-8">
        <h2 id="breakdown-heading" className={`mb-2 ${h2}`}>
          Where it went
        </h2>
        {d.spending === 0 ? (
          <p className="text-muted">No spending recorded in this month.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <ShareList title="By category, largest first" items={d.byCategory} total={d.spending} />
            <ShareList title="By account" items={d.byAccount} total={d.spending} />
          </div>
        )}
      </section>

      <section aria-labelledby="compare-heading" className="mt-8">
        <h2 id="compare-heading" className={`mb-2 ${h2}`}>
          Compared with your usual
        </h2>
        <div className="rounded-2xl border border-border bg-surface p-5">
          {comparison.kind === "not-enough-history" ? (
            <p className="text-muted">Comparisons appear after two full months of data.</p>
          ) : (
            <>
              <p>
                {period} <Amount value={comparison.current} className="font-semibold" />. Over the same days of the last{" "}
                {comparison.months} full months you spent <Amount value={comparison.baseline} className="font-semibold" /> on
                average
                {comparison.change.isNotable ? `, so this is ${changeWords(comparison.change)} your usual.` : ", so nothing stands out."}
              </p>
              {d.notable.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {d.notable.map((n) => (
                    <li key={n.name}>
                      <span className="font-medium">{n.name}</span>: <Amount value={n.current} /> against a usual{" "}
                      <Amount value={n.baseline} />, {changeWords(n.change)} your usual.
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="mt-4 border-t border-border pt-4 text-sm text-muted">
            Spent so far this year: <Amount value={d.year.spent} className="font-medium text-foreground" />.{" "}
            {d.year.comparison ? (
              <>
                The same dates last year: <Amount value={d.year.comparison.baseline} />
                {d.year.comparison.change.isNotable ? `, so this year is ${changeWords(d.year.comparison.change)} last year` : ", about the same"}.
              </>
            ) : (
              "A comparison with last year appears once you have data back to January of last year."
            )}
          </p>
        </div>
      </section>

      <section aria-labelledby="transactions-heading" className="mt-8">
        <h2 id="transactions-heading" className={h2}>
          Transactions
        </h2>
        <TransactionList
          rows={d.rows}
          accounts={d.accounts.map((a) => ({ id: a.id, name: a.name, archived: a.archivedAt !== null }))}
          categories={d.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: c.archivedAt !== null }))}
          today={d.today}
        />
      </section>
    </Wide>
  );
}
