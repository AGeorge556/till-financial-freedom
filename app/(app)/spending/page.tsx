import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { formatMonthYear, formatRange } from "@/components/dates";
import { type ListRow, TransactionList } from "@/components/TransactionList";
import { getSettings, listAccounts, listCategories, listTransactions, toLedgerTx } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { periodSummary } from "@/lib/finance-core/ledger";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";

export const metadata: Metadata = { title: "Spending" };

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const arrow = "grid size-11 place-items-center rounded-full border border-border text-lg";

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const userId = await requireUserId();
  const [settings, accounts, categories] = await Promise.all([
    getSettings(userId),
    listAccounts(userId, { includeArchived: true }),
    listCategories(userId, { includeArchived: true }),
  ]);

  const today = cairoToday();
  const startDay = String(settings.monthStartDay).padStart(2, "0");
  const current = financialMonth(today, settings.monthStartDay).start.slice(0, 7);
  const requested = (await searchParams).m;
  // The URL carries only the month a financial month starts in; anything else falls back to the current one.
  const month = typeof requested === "string" && MONTH.test(requested) ? requested : current;
  const { start, end } = financialMonth(`${month}-${startDay}`, settings.monthStartDay);

  const txRows = await listTransactions(userId, { from: start, to: end });
  const spending = periodSummary(txRows.map(toLedgerTx)).spending;

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const rows: ListRow[] = txRows.map((r) => {
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
      category: r.categoryId ? (categoryName.get(r.categoryId) ?? null) : null,
      account: r.type === "TRANSFER" ? `${from ?? "?"} → ${to ?? "?"}` : (from ?? to ?? "?"),
    };
  });

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Spending</h1>

      <nav aria-label="Month" className="mt-6 flex items-center justify-between gap-3">
        <Link href={`/spending?m=${shiftMonth(month, -1)}`} aria-label="Previous month" className={arrow}>
          ‹
        </Link>
        <div className="text-center">
          <p className="font-medium">{formatMonthYear(start)}</p>
          <p className="text-sm text-muted">{formatRange(start, end)}</p>
        </div>
        {month < current ? (
          <Link href={`/spending?m=${shiftMonth(month, 1)}`} aria-label="Next month" className={arrow}>
            ›
          </Link>
        ) : (
          <span aria-hidden="true" className="size-11" />
        )}
      </nav>

      <div className="mt-6">
        <p className="text-sm text-muted">Total spent</p>
        <Amount value={spending} className="mt-1 block text-4xl font-semibold tracking-tight text-spending" />
      </div>

      <TransactionList
        rows={rows}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, archived: a.archivedAt !== null }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: c.archivedAt !== null }))}
        today={today}
      />
    </>
  );
}
