"use client";

import Link from "next/link";
import { useState } from "react";
import type { TxType } from "@/lib/finance-core/ledger";
import { Amount } from "./Amount";
import { formatWeekday } from "./dates";
import { Sheet } from "./Sheet";
import { type AccountOption, type CategoryOption, type Kind, TransactionForm } from "./TransactionForm";

/** One transaction as the page prepared it: names already resolved, amount in piasters. */
export type ListRow = {
  id: string;
  type: TxType;
  date: string;
  amount: number;
  status: "pending" | "posted" | "void";
  note: string | null;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  category: string | null;
  account: string;
};

const TYPE_LABEL: Record<TxType, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
  INVESTMENT_PURCHASE: "Investment purchase",
  INVESTMENT_SALE: "Investment sale",
  LIABILITY_PAYMENT: "Loan payment",
  DIVIDEND: "Dividend",
  INTEREST: "Interest",
  ADJUSTMENT: "Balance adjustment",
};

/** Sign and colour of the amount by kind: money out red, money in green, transfers neutral, adjustments muted. */
function tone(row: ListRow): { sign: string; cls: string; value: number } {
  switch (row.type) {
    case "EXPENSE":
    case "LIABILITY_PAYMENT":
      return { sign: "−", cls: "text-negative", value: row.amount };
    case "INVESTMENT_PURCHASE":
      // Cash out, but not spending.
      return { sign: "−", cls: "", value: row.amount };
    case "INCOME":
    case "INVESTMENT_SALE":
    case "DIVIDEND":
    case "INTEREST":
      return { sign: "+", cls: "text-positive", value: row.amount };
    case "TRANSFER":
      return { sign: "", cls: "", value: row.amount };
    case "ADJUSTMENT":
      return { sign: row.amount < 0 ? "−" : "+", cls: "text-muted", value: Math.abs(row.amount) };
  }
}

const isInvestmentRow = (row: ListRow) =>
  row.type === "INVESTMENT_PURCHASE" || row.type === "INVESTMENT_SALE" || row.type === "DIVIDEND";

const isEditable = (row: ListRow) =>
  row.status !== "void" && (row.type === "EXPENSE" || row.type === "INCOME" || row.type === "TRANSFER");

function Row({ row, onOpen }: { row: ListRow; onOpen: (row: ListRow) => void }) {
  const { sign, cls, value } = tone(row);
  const voided = row.status === "void";
  const body = (
    <>
      <span className="min-w-0">
        <span className={`block truncate font-medium ${voided ? "line-through" : ""}`}>
          {row.category ?? TYPE_LABEL[row.type]}
          {row.status === "pending" && (
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-normal text-muted">
              Pending
            </span>
          )}
          {voided && (
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-normal text-muted">
              Voided
            </span>
          )}
        </span>
        <span className="block truncate text-sm text-muted">
          {row.account}
          {row.note ? ` · ${row.note}` : ""}
        </span>
      </span>
      <span className={`shrink-0 font-medium ${voided ? "text-muted line-through" : cls}`}>
        {sign}
        <Amount value={value} showPiasters />
      </span>
    </>
  );
  const layout = "flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left";
  return isEditable(row) ? (
    <button type="button" onClick={() => onOpen(row)} className={layout}>
      {body}
    </button>
  ) : (
    <div className={`${layout} ${voided ? "opacity-60" : ""}`}>{body}</div>
  );
}

export function TransactionList({
  rows,
  accounts,
  categories,
  today,
}: {
  rows: ListRow[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [showVoided, setShowVoided] = useState(false);
  const [selected, setSelected] = useState<ListRow | null>(null);

  const voidedCount = rows.filter((r) => r.status === "void").length;
  const visible = showVoided ? rows : rows.filter((r) => r.status !== "void");
  // Rows arrive newest first, so a day is a run of consecutive rows.
  const days: { date: string; rows: ListRow[] }[] = [];
  for (const row of visible) {
    const last = days[days.length - 1];
    if (last?.date === row.date) last.rows.push(row);
    else days.push({ date: row.date, rows: [row] });
  }

  return (
    <>
      {voidedCount > 0 && (
        <button
          type="button"
          aria-pressed={showVoided}
          onClick={() => setShowVoided((v) => !v)}
          className="mt-4 min-h-11 rounded-xl border border-border px-4 text-sm font-medium"
        >
          {showVoided ? "Hide voided" : `Show voided (${voidedCount})`}
        </button>
      )}

      {visible.some(isInvestmentRow) && (
        <p className="mt-4 text-sm text-muted">
          Investment buys, sales and dividends are not spending. Change or void them on the holding&apos;s page in{" "}
          <Link href="/investments" className="underline">
            Investments
          </Link>
          .
        </p>
      )}

      {visible.length === 0 ? (
        <p className="mt-6 text-muted">Nothing recorded in this period. Tap + to add a transaction.</p>
      ) : (
        days.map((day) => (
          <section key={day.date} className="mt-6">
            <h2 className="mb-2 text-sm font-medium text-muted">{formatWeekday(day.date)}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {day.rows.map((row) => (
                <li key={row.id}>
                  <Row row={row} onOpen={setSelected} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Sheet open={selected !== null} onClose={() => setSelected(null)} label="Edit transaction">
        {selected && (
          <>
            <h2 className="mr-11 mb-5 text-lg font-semibold tracking-tight">Edit {TYPE_LABEL[selected.type].toLowerCase()}</h2>
            <TransactionForm
              key={selected.id}
              kind={selected.type as Kind}
              accounts={accounts}
              categories={categories}
              today={today}
              initial={selected}
              onDone={() => setSelected(null)}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
