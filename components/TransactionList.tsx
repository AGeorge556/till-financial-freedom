"use client";

import { useState } from "react";
import type { TxType } from "@/lib/finance-core/ledger";
import { AdjustmentForm } from "./AdjustmentForms";
import { Amount } from "./Amount";
import { CloudFlowForm } from "./CloudForms";
import { RemovedTag, RemovedToggle, useEntrySheet } from "./Correct";
import { formatWeekday } from "./dates";
import { dateText, type KIND_LABEL } from "./HoldingFormat";
import { DividendForm, TradeForm } from "./HoldingForms";
import { PaymentForm } from "./LiabilityForms";
import { PendingRecurringRow } from "./RecurringPending";
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
  /** Set on a loan payment's rows (principal and interest). Either one opens the whole payment. */
  liabilityId: string | null;
  /** A loan payment as one: both of its rows carry it. */
  payment: { principal: number; interest: number; categoryId: string | null } | null;
  /** The holding of an investment row (a buy, sale, dividend, or a Savings Cloud deposit or withdrawal). */
  holding: { id: string; name: string; ticker: string | null; kind: keyof typeof KIND_LABEL; accountId: string } | null;
  quantity: string | null;
  unitPrice: string | null;
  fee: number;
  taxWithheld: number | null;
  grossAmount: number | null;
  /** Set on a row generated from a recurring item. */
  recurringTemplateId: string | null;
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

const isPendingRecurring = (row: ListRow) => row.status === "pending" && row.recurringTemplateId !== null;

/** Which sheet a row opens: the form it was created with. null for a row that has none (savings interest has no way in). */
function sheetOf(row: ListRow): "ordinary" | "trade" | "flow" | "dividend" | "payment" | "adjustment" | null {
  if (row.liabilityId !== null && row.payment !== null) return "payment";
  switch (row.type) {
    case "EXPENSE":
    case "INCOME":
    case "TRANSFER":
      return "ordinary";
    case "INVESTMENT_PURCHASE":
    case "INVESTMENT_SALE":
      return row.holding === null ? null : row.quantity === null ? "flow" : "trade";
    case "DIVIDEND":
      return row.holding === null ? null : "dividend";
    case "ADJUSTMENT":
      return "adjustment";
    default:
      return null;
  }
}

const isEditable = (row: ListRow) => row.status !== "void" && sheetOf(row) !== null;

/** What a screen reader hears after "Edit" and after "Remove": "investment purchase of 3 Oct 2026". */
const what = (row: ListRow) => `${TYPE_LABEL[row.type].toLowerCase()} of ${dateText(row.date)}`;

function Row({ row, onOpen }: { row: ListRow; onOpen: (row: ListRow) => void }) {
  if (isPendingRecurring(row)) return <PendingRecurringRow item={row} />;
  const { sign, cls, value } = tone(row);
  const voided = row.status === "void";
  const body = (
    <>
      <span className="min-w-0">
        <span dir="auto" className={`block break-words font-medium ${voided ? "line-through" : ""}`}>
          {row.category ?? TYPE_LABEL[row.type]}
          {row.status === "pending" && (
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-normal text-muted">
              Pending
            </span>
          )}
          {voided && <RemovedTag />}
        </span>
        <span dir="auto" className="block line-clamp-2 break-words text-sm text-muted">
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
    <button type="button" data-entry-key={row.id} onClick={() => onOpen(row)} aria-haspopup="dialog" className={layout}>
      <span className="sr-only">Edit {TYPE_LABEL[row.type].toLowerCase()}: </span>
      {body}
      <span aria-hidden="true" className="shrink-0 text-lg text-muted">
        ›
      </span>
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
  const [showRemoved, setShowRemoved] = useState(false);
  const { selected, listRef, open, close } = useEntrySheet<ListRow>((r) => r.id);

  const removedCount = rows.filter((r) => r.status === "void").length;
  const visible = showRemoved ? rows : rows.filter((r) => r.status !== "void");
  // Rows arrive newest first, so a day is a run of consecutive rows.
  const days: { date: string; rows: ListRow[] }[] = [];
  for (const row of visible) {
    const last = days[days.length - 1];
    if (last?.date === row.date) last.rows.push(row);
    else days.push({ date: row.date, rows: [row] });
  }

  const kind = selected ? sheetOf(selected) : null;
  const heading = selected ? `Edit ${TYPE_LABEL[selected.type].toLowerCase()}` : "Edit";
  const accountId = selected ? (selected.fromAccountId ?? selected.toAccountId) : null;

  return (
    <>
      <RemovedToggle count={removedCount} shown={showRemoved} onToggle={() => setShowRemoved((v) => !v)} />

      {visible.some(isEditable) && <p className="mt-4 text-sm text-muted">Tap an entry to change or remove it.</p>}

      {visible.some(isInvestmentRow) && (
        <p className="mt-4 text-sm text-muted">Investment buys, sales and dividends are not spending. Tap one to correct or remove it.</p>
      )}

      {visible.length === 0 ? (
        <p className="mt-6 text-muted">Nothing recorded in this period. Tap + to add a transaction.</p>
      ) : (
        <div
          ref={(el) => {
            listRef.current = el;
          }}
          tabIndex={-1}
          className="outline-none"
        >
          {days.map((day) => (
            <section key={day.date} className="mt-6">
              <h3 className="mb-2 text-sm font-medium text-muted">{formatWeekday(day.date)}</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {day.rows.map((row) => (
                  <li key={row.id}>
                    <Row row={row} onOpen={open} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Sheet open={selected !== null} onClose={close} label={heading}>
        {selected && (
          <>
            <h2 className="mr-11 mb-5 text-lg font-semibold tracking-tight">{heading}</h2>
            {kind === "ordinary" && (
              <TransactionForm
                key={selected.id}
                kind={selected.type as Kind}
                accounts={accounts}
                categories={categories}
                today={today}
                initial={selected}
                onDone={close}
              />
            )}
            {kind === "trade" && selected.holding && (
              <TradeForm
                key={selected.id}
                side={selected.type === "INVESTMENT_PURCHASE" ? "buy" : "sell"}
                holdings={[selected.holding]}
                accounts={accounts}
                today={today}
                onDone={close}
                editing={{
                  id: selected.id,
                  quantity: selected.quantity ?? "0",
                  unitPrice: selected.unitPrice ?? "0",
                  fee: selected.fee,
                  tax: selected.taxWithheld ?? 0,
                  date: selected.date,
                  note: selected.note,
                  accountId,
                  what: what(selected),
                }}
              />
            )}
            {kind === "dividend" && selected.holding && (
              <DividendForm
                key={selected.id}
                holdingId={selected.holding.id}
                accountId={selected.holding.accountId}
                accounts={accounts}
                today={today}
                onDone={close}
                editing={{
                  id: selected.id,
                  gross: selected.grossAmount ?? selected.amount,
                  tax: selected.taxWithheld ?? 0,
                  date: selected.date,
                  note: selected.note,
                  accountId,
                  what: what(selected),
                }}
              />
            )}
            {kind === "flow" && selected.holding && (
              <CloudFlowForm
                key={selected.id}
                side={selected.type === "INVESTMENT_PURCHASE" ? "deposit" : "withdraw"}
                holdingId={selected.holding.id}
                accountId={selected.holding.accountId}
                accounts={accounts}
                today={today}
                onDone={close}
                editing={{ id: selected.id, amount: selected.amount, date: selected.date, note: selected.note, accountId, what: what(selected) }}
              />
            )}
            {kind === "payment" && selected.liabilityId && selected.payment && (
              <PaymentForm
                key={selected.id}
                liabilityId={selected.liabilityId}
                accounts={accounts}
                categories={categories}
                today={today}
                onDone={close}
                editing={{
                  id: selected.id,
                  principal: selected.payment.principal,
                  interest: selected.payment.interest,
                  categoryId: selected.payment.categoryId,
                  accountId: selected.fromAccountId,
                  date: selected.date,
                  note: selected.note,
                  what: what(selected),
                }}
              />
            )}
            {kind === "adjustment" && (
              <AdjustmentForm
                key={selected.id}
                row={{ id: selected.id, date: selected.date, amount: selected.amount, note: selected.note }}
                onDone={close}
              />
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
