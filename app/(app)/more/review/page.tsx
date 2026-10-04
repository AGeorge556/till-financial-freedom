import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { formatDay } from "@/components/dates";
import { changeWords, percentText, ReviewLine, ReviewSection, Signed } from "@/components/ReviewParts";
import { BackLink, card } from "@/components/ui";
import { Wide } from "@/components/Wide";
import { requireUserId } from "@/lib/auth";
import { MonthNav } from "../../spending/MonthNav";
import { type Compared, loadReview } from "./data";

export const metadata: Metadata = { title: "Monthly review" };

function CompareLine({ label, c }: { label: string; c: Compared }) {
  return (
    <ReviewLine
      label={label}
      note={
        <>
          Average of the last full months: <Amount value={c.baseline} />
          {c.change.isNotable ? `, so this is ${changeWords(c.change)} your usual.` : ", so nothing stands out."}
        </>
      }
    >
      <Amount value={c.current} />
    </ReviewLine>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const userId = await requireUserId();
  const d = await loadReview(userId, (await searchParams).m);
  const { review: r, compare } = d;
  const spendingCompare = compare.spending;

  return (
    <Wide>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Monthly review</h1>

      <MonthNav base="/more/review" month={d.month} current={d.current} monthStartDay={d.startDay} />
      {d.inProgress && (
        <p className="mt-3 text-center text-sm text-muted">
          This month is still running, so these figures are up to {formatDay(d.range.end)}.
        </p>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
        <ReviewSection title="Income and spending">
          <ReviewLine
            label="Income"
            note={
              <>
                Earned <Amount value={r.earnedIncome} /> · From investments <Amount value={r.investmentIncome} />
              </>
            }
          >
            <Amount value={r.totalIncome} />
          </ReviewLine>
          <ReviewLine label="Spending">
            <Amount value={r.spending} className="text-spending" />
          </ReviewLine>
          <ReviewLine label="Saved" strong note="Income minus spending. It can be below zero.">
            <Signed value={r.saved} />
          </ReviewLine>
          <ReviewLine label="Of which invested" indent note="Bought minus sold this month.">
            <Amount value={r.invested} />
          </ReviewLine>
          <ReviewLine label="Of which kept as cash" indent>
            <Signed value={r.keptAsCash} />
          </ReviewLine>
          <ReviewLine label="Savings rate" note="The share of your income you saved.">
            {percentText(r.savingsRate)}
          </ReviewLine>
        </ReviewSection>

        <div>
          <ReviewSection title="What happened to your net worth">
            <ReviewLine label="Market change on investments" note="Price moves and growth, not money you put in or took out.">
              <Signed value={r.marketChange} />
            </ReviewLine>
            <ReviewLine label="Adjustments" note="Balance corrections and loan balance updates.">
              <Signed value={r.adjustments} />
            </ReviewLine>
            <ReviewLine label="Net worth change" strong>
              <Signed value={r.netWorthChange} />
            </ReviewLine>
          </ReviewSection>

          <section aria-labelledby="reconcile-heading" className={`mt-4 p-4 ${card}`}>
            <h2 id="reconcile-heading" className="text-sm font-medium text-muted">
              Net worth change = saved + market change + adjustments
            </h2>
            <p className="mt-2 break-words">
              <Signed value={r.netWorthChange} className="font-semibold" /> = <Signed value={r.saved} /> +{" "}
              <Signed value={r.marketChange} /> + <Signed value={r.adjustments} />
            </p>
            {r.reconciles ? (
              <p className="mt-2 text-sm text-positive">✓ These add up exactly.</p>
            ) : (
              <p role="alert" className="mt-2 text-sm text-negative">
                ✕ These do not add up. The difference is <Amount value={Math.abs(r.difference)} className="font-semibold" />: net
                worth moved by that much {r.difference > 0 ? "more" : "less"} than the other three explain. Nothing has been
                hidden or adjusted to cover it.
              </p>
            )}
          </section>
        </div>

        <ReviewSection
          title="Set aside for goals"
          hint="These are earmarks on money you already have, not extra money. They do not change your net worth."
        >
          {d.perGoal.length === 0 && (
            <ReviewLine
              label="No goal funded"
              indent
              note={
                <>
                  Nothing was set aside for a goal this month.{" "}
                  <Link href="/goals" className="underline">
                    Open goals
                  </Link>
                </>
              }
            >
              <Amount value={0} />
            </ReviewLine>
          )}
          {d.perGoal.map((g) => (
            <ReviewLine key={g.id} label={g.name} indent>
              <Signed value={g.amount} />
            </ReviewLine>
          ))}
          <ReviewLine label="Set aside for goals" strong>
            <Signed value={r.goalAllocations} />
          </ReviewLine>
          <ReviewLine
            label="Saved but not set aside"
            note={
              r.unallocated < 0 ? (
                <>
                  You set aside <Amount value={-r.unallocated} /> more than you saved this month, using money saved earlier.
                </>
              ) : undefined
            }
          >
            <Signed value={r.unallocated} />
          </ReviewLine>
        </ReviewSection>

        <section aria-labelledby="compare-heading" className="mt-8">
          <h2 id="compare-heading" className="text-lg font-semibold tracking-tight">
            Compared with earlier months
          </h2>
          {spendingCompare.kind === "not-enough-history" ? (
            <p className="mt-2 text-muted">Comparisons appear after two full months of data.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                Against the average of the last {spendingCompare.months} full months
                {d.inProgress ? ", over the same days of each month" : ""}.
              </p>
              <dl className={`mt-2 divide-y divide-border px-4 ${card}`}>
                <CompareLine label="Spending" c={spendingCompare} />
                {compare.others && (
                  <>
                    <CompareLine label="Income" c={compare.others.income} />
                    <CompareLine label="Saved" c={compare.others.saved} />
                  </>
                )}
              </dl>
              {d.inProgress && <p className="mt-2 text-sm text-muted">Income and saved are compared once the month is over.</p>}
            </>
          )}
        </section>
      </div>
    </Wide>
  );
}
