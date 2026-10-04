import type { Metadata } from "next";
import Link from "next/link";
import { HistoryChart } from "@/components/HistoryChart";
import { BackLink } from "@/components/ui";
import { firstTransactionDate, loadHistory } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { HISTORY_RANGES, type HistoryRange, samplingDates } from "@/lib/finance-core/history";
import { cairoToday } from "@/lib/finance-core/time";

export const metadata: Metadata = { title: "Net worth history" };

const LABEL: Record<HistoryRange, string> = { "7d": "7 days", "1m": "1 month", "3m": "3 months", "6m": "6 months", "1y": "1 year", all: "All time" };

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const userId = await requireUserId();
  const requested = (await searchParams).range;
  // The URL carries only the range key; anything else falls back to 3 months.
  const range = HISTORY_RANGES.find((r) => r === requested) ?? "3m";
  const points = await loadHistory(userId, samplingDates(range, await firstTransactionDate(userId), cairoToday()));

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Net worth history</h1>

      <nav aria-label="Time range" className="mt-4 flex flex-wrap gap-2">
        {HISTORY_RANGES.map((r) => (
          <Link
            key={r}
            href={`/more/history?range=${r}`}
            aria-current={r === range ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium ${r === range ? "border-foreground bg-foreground text-background" : "border-border"}`}
          >
            {LABEL[r]}
          </Link>
        ))}
      </nav>

      {points.length < 2 ? (
        <p className="mt-6 text-muted">
          There is not enough history yet to draw a line. Add a transaction dated before today and it will appear here.
        </p>
      ) : (
        <HistoryChart points={points} />
      )}

      <p className="mt-4 text-sm text-muted">
        History is worked out from your records each time you open this page. A value stays the same until your next update,
        and fixing an old transaction or price changes the past automatically. Debt is loans plus any credit card you owe on.
      </p>
    </>
  );
}
