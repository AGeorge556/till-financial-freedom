"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { HistoryEntry } from "@/app/(app)/investments/data";
import { Amount } from "./Amount";
import { CloudConfirmForm, CloudFlowForm, CloudRateForm } from "./CloudForms";
import { EntryList } from "./Correct";
import { formatRate } from "./GoalFormat";
import { dateText, plain } from "./HoldingFormat";
import { CorporateActionForm, DividendForm, type HoldingOption, PriceForm, TradeForm } from "./HoldingForms";
import { HoldingPrivate } from "./HoldingPrivate";
import type { AccountOption } from "./TransactionForm";

function describe(e: HistoryEntry, gold: boolean): { title: ReactNode; detail?: ReactNode; amount?: ReactNode } {
  switch (e.kind) {
    case "buy":
      return {
        title: (
          <>
            Bought <HoldingPrivate>{plain(e.quantity)}</HoldingPrivate>
            {gold ? " g at " : " at "}
            <HoldingPrivate>{plain(e.price)}</HoldingPrivate>
            {gold && " per gram"}
          </>
        ),
        detail: e.fee > 0 && (
          <>
            {gold ? "Workmanship" : "Fee"} <Amount value={e.fee} showPiasters />, added to your cost
          </>
        ),
        amount: (
          <>
            −<Amount value={e.amount} showPiasters />
          </>
        ),
      };
    case "sell":
      return {
        title: (
          <>
            Sold <HoldingPrivate>{plain(e.quantity)}</HoldingPrivate>
            {gold ? " g at " : " at "}
            <HoldingPrivate>{plain(e.price)}</HoldingPrivate>
            {gold && " per gram"}
          </>
        ),
        detail: (e.fee > 0 || e.tax > 0) && (
          <>
            Fee <Amount value={e.fee} showPiasters />, tax <Amount value={e.tax} showPiasters />
          </>
        ),
        amount: (
          <span className="text-positive">
            +<Amount value={e.amount} showPiasters />
          </span>
        ),
      };
    case "dividend":
      return {
        title: "Dividend",
        detail: (
          <>
            Before tax <Amount value={e.gross} showPiasters />, tax <Amount value={e.tax} showPiasters />
          </>
        ),
        amount: (
          <span className="text-positive">
            +<Amount value={e.amount} showPiasters />
          </span>
        ),
      };
    case "deposit":
      return {
        title: "Deposit",
        detail: "Investing, not spending.",
        amount: (
          <>
            −<Amount value={e.amount} showPiasters />
          </>
        ),
      };
    case "withdrawal":
      return {
        title: "Withdrawal",
        amount: (
          <span className="text-positive">
            +<Amount value={e.amount} showPiasters />
          </span>
        ),
      };
    case "rate":
      return { title: `Yearly rate (APY) set to ${formatRate(e.apy)}`, detail: "Takes effect on the date shown." };
    case "confirmed":
      return {
        title: (
          <>
            Confirmed value <Amount value={e.value} showPiasters />
          </>
        ),
        detail: "The new starting point for the estimate.",
      };
    case "bonus":
      return { title: <>Bonus units: +<HoldingPrivate>{plain(e.quantity)}</HoldingPrivate></>, detail: "No cash moved. Total cost unchanged." };
    case "split":
      return { title: <>Split, units × <HoldingPrivate>{plain(e.ratio)}</HoldingPrivate></>, detail: "No cash moved. Total cost unchanged." };
    case "writeOff":
      return { title: "Written off", detail: "Units and cost went to zero. The remaining cost is a realized loss." };
    case "price":
      return { title: <>Price set to <HoldingPrivate>{plain(e.price)}</HoldingPrivate> per unit</> };
  }
}

const NAME: Record<HistoryEntry["kind"], string> = {
  buy: "buy",
  sell: "sale",
  dividend: "dividend",
  deposit: "deposit",
  withdrawal: "withdrawal",
  rate: "rate change",
  confirmed: "confirmed value",
  bonus: "bonus units",
  split: "split",
  writeOff: "write-off",
  price: "price",
};

const what = (e: HistoryEntry) => `${NAME[e.kind]} of ${dateText(e.date)}`;

/**
 * Dated history of one holding, newest first. Every entry opens the form it was made with, filled in, to be corrected or
 * removed; removed entries wait behind "Show removed". A gold price is shared, so it is corrected on the Investments page.
 */
export function HoldingHistory({
  entries,
  holding,
  accounts,
  today,
  gold = false,
}: {
  entries: HistoryEntry[];
  holding: HoldingOption;
  accounts: AccountOption[];
  today: string;
  gold?: boolean;
}) {
  return (
    <EntryList
      entries={entries}
      name={what}
      title={(e) => `Edit ${what(e)}`}
      editable={(e) => !(e.kind === "price" && e.id === null)}
      row={(e) => {
        const { title, detail, amount } = describe(e, gold);
        return (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words font-medium">{title}</span>
              {amount && <span className="shrink-0 font-medium">{amount}</span>}
            </span>
            <span className="block break-words text-sm text-muted">
              {dateText(e.date)}
              {e.note ? ` · ${e.note}` : ""}
            </span>
            {detail && <span className="block break-words text-sm text-muted">{detail}</span>}
            {gold && e.kind === "price" && !e.removed && (
              <Link href="/investments" className="block min-h-11 py-2 text-sm underline">
                Gold prices are shared: correct this one on the Investments page
              </Link>
            )}
          </>
        );
      }}
      sheet={(e, done) => {
        const label = what(e);
        switch (e.kind) {
          case "buy":
          case "sell":
            return (
              <TradeForm
                side={e.kind === "buy" ? "buy" : "sell"}
                holdings={[holding]}
                accounts={accounts}
                today={today}
                onDone={done}
                editing={{
                  id: e.txId,
                  quantity: e.quantity,
                  unitPrice: e.price,
                  fee: e.fee,
                  tax: e.kind === "sell" ? e.tax : 0,
                  date: e.date,
                  note: e.note,
                  accountId: e.accountId,
                  what: label,
                }}
              />
            );
          case "dividend":
            return (
              <DividendForm
                holdingId={holding.id}
                accountId={holding.accountId}
                accounts={accounts}
                today={today}
                onDone={done}
                editing={{ id: e.txId, gross: e.gross, tax: e.tax, date: e.date, note: e.note, accountId: e.accountId, what: label }}
              />
            );
          case "deposit":
          case "withdrawal":
            return (
              <CloudFlowForm
                side={e.kind === "deposit" ? "deposit" : "withdraw"}
                holdingId={holding.id}
                accountId={holding.accountId}
                accounts={accounts}
                today={today}
                onDone={done}
                editing={{ id: e.txId, amount: e.amount, date: e.date, note: e.note, accountId: e.accountId, what: label }}
              />
            );
          case "rate":
            return <CloudRateForm holdingId={holding.id} today={today} onDone={done} editing={{ id: e.key, apy: e.apy, date: e.date, what: label }} />;
          case "confirmed":
            return <CloudConfirmForm holdingId={holding.id} today={today} onDone={done} editing={{ id: e.key, value: e.value, date: e.date, what: label }} />;
          case "bonus":
          case "split":
          case "writeOff":
            return (
              <CorporateActionForm
                holdingId={holding.id}
                today={today}
                writeOffOnly={gold}
                onDone={done}
                editing={{
                  id: e.key,
                  kind: e.kind === "bonus" ? "BONUS" : e.kind === "split" ? "SPLIT" : "WRITE_OFF",
                  quantity: e.kind === "bonus" ? e.quantity : null,
                  ratio: e.kind === "split" ? e.ratio : null,
                  date: e.date,
                  note: e.note,
                  what: label,
                }}
              />
            );
          case "price":
            return e.id === null ? null : (
              <PriceForm holdings={[holding]} today={today} onDone={done} editing={{ id: e.id, price: e.price, date: e.date, what: label }} />
            );
        }
      }}
    />
  );
}
