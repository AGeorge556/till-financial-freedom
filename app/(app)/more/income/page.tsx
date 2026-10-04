import type { Metadata } from "next";
import { Amount } from "@/components/Amount";
import { formatMonthYear } from "@/components/dates";
import { EmptyState } from "@/components/EmptyState";
import { changeWords } from "@/components/ReviewParts";
import { TransactionList } from "@/components/TransactionList";
import { BackLink, card } from "@/components/ui";
import { Wide } from "@/components/Wide";
import { requireUserId } from "@/lib/auth";
import { MonthNav } from "../../spending/MonthNav";
import { loadIncome } from "./data";

export const metadata: Metadata = { title: "Income" };

const h2 = "text-lg font-semibold tracking-tight";

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const userId = await requireUserId();
  const d = await loadIncome(userId, (await searchParams).m);
  const { average, growth } = d;
  const monthName = formatMonthYear(d.range.start);

  return (
    <Wide>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Income</h1>

      {!d.hasIncome ? (
        <div className="mt-6">
          <EmptyState accent="cash" title="No income yet" items={["Salary", "Side work", "Dividends", "Interest"]}>
            Nothing has been recorded as income. Tap + and choose Income to add your first, or set up a repeating one in Recurring.
          </EmptyState>
        </div>
      ) : (
        <>
          <MonthNav base="/more/income" month={d.month} current={d.current} monthStartDay={d.startDay} />

          <div className="mt-6">
            <p className="text-sm text-muted">{d.isCurrent ? "Income so far this month" : `Income in ${monthName}`}</p>
            <Amount value={d.total} className="mt-1 block text-4xl font-semibold tracking-tight text-positive" />
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">Earned</dt>
                <dd className="font-medium">
                  <Amount value={d.earned} />
                </dd>
              </div>
              <div>
                <dt className="text-muted">From investments</dt>
                <dd className="font-medium">
                  <Amount value={d.investment} />
                </dd>
              </div>
            </dl>
          </div>

          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className={`p-4 ${card}`}>
              <dt className="text-sm text-muted">Average a month</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight">
                {average.kind === "average" ? <Amount value={average.value} /> : "Not enough history yet"}
              </dd>
              <dd className="mt-1 text-sm text-muted">
                {average.kind === "average"
                  ? "Earned and investment income together, over up to 3 full months before this one."
                  : "Needs two full months of data before this month."}
              </dd>
            </div>
            <div className={`p-4 ${card}`}>
              <dt className="text-sm text-muted">So far in {d.year.label}</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight">
                <Amount value={d.year.income} />
              </dd>
              <dd className="mt-1 text-sm text-muted">Earned and investment income, January to today.</dd>
            </div>
          </dl>

          <section aria-labelledby="growth-heading" className="mt-8">
            <h2 id="growth-heading" className={`mb-2 ${h2}`}>
              Growth
            </h2>
            <div className={`p-5 ${card}`}>
              {growth ? (
                <p>
                  Income in {formatMonthYear(growth.later.start)} was <Amount value={growth.later.income} className="font-semibold" />,{" "}
                  {changeWords(growth.change)} {formatMonthYear(growth.earlier.start)} (<Amount value={growth.earlier.income} />).
                </p>
              ) : (
                <p className="text-muted">Growth appears once you have two full months of data.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="source-heading" className="mt-8">
            <h2 id="source-heading" className={`mb-2 ${h2}`}>
              Where it came from
            </h2>
            {d.bySource.length === 0 ? (
              <p className="text-muted">No earned income recorded in this month.</p>
            ) : (
              <>
                <h3 className="mb-2 font-medium">Earned, by category</h3>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {d.bySource.map((item) => {
                    const pct = Math.round(item.share * 100);
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
                          aria-label={`${item.name} share of earned income`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={pct}
                          aria-valuetext={`${pct} percent of this month's earned income`}
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
                        >
                          <div className="h-full rounded-full bg-positive" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <p className="mt-3 text-sm text-muted">
              Dividends and interest from your investments are counted apart from earned income:{" "}
              <Amount value={d.investment} className="font-medium text-foreground" /> in this month.
            </p>
          </section>

          <section aria-labelledby="list-heading" className="mt-8">
            <h2 id="list-heading" className={h2}>
              Income in this month
            </h2>
            {d.rows.length === 0 ? (
              <p className="mt-2 text-muted">No income recorded in this month.</p>
            ) : (
              <TransactionList
                rows={d.rows}
                accounts={d.accounts.map((a) => ({ id: a.id, name: a.name, archived: a.archivedAt !== null }))}
                categories={d.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: c.archivedAt !== null }))}
                today={d.today}
              />
            )}
          </section>
        </>
      )}
    </Wide>
  );
}
