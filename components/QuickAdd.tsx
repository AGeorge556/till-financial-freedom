"use client";

import Link from "next/link";
import { useState } from "react";
import { type HoldingOption, PriceForm, TradeForm } from "./HoldingForms";
import { Sheet } from "./Sheet";
import { type AccountOption, type CategoryOption, type Kind, TransactionForm } from "./TransactionForm";

type Tab = Kind | "INVESTMENT" | "PRICE";

const TABS: { tab: Tab; label: string; investing?: boolean }[] = [
  { tab: "EXPENSE", label: "Expense" },
  { tab: "INCOME", label: "Income" },
  { tab: "TRANSFER", label: "Transfer" },
  { tab: "INVESTMENT", label: "Investment", investing: true },
  { tab: "PRICE", label: "Price update", investing: true },
];

/**
 * Floating + button and the sheet it opens. Accounts and categories come from the layout (active ones only).
 * The investing tabs appear only when the layout passes `holdings` (active holdings, possibly none).
 */
export function QuickAdd({
  accounts,
  categories,
  holdings,
  today,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  holdings?: HoldingOption[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("EXPENSE");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const close = () => setOpen(false);
  const tabs = TABS.filter((t) => !t.investing || holdings !== undefined);

  const missing =
    accounts.length === 0
      ? "You need an account before you can record anything."
      : tab === "TRANSFER" && accounts.length < 2
        ? "A transfer needs two accounts."
        : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTab("EXPENSE");
          setOpen(true);
        }}
        aria-label="Add transaction"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-foreground text-background shadow-lg md:right-8 md:bottom-8"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <Sheet open={open} onClose={close} label="Add transaction">
        <div className="mr-11 grid grid-cols-6 gap-1 rounded-xl bg-background p-1">
          {tabs.map((t) => (
            <button
              key={t.tab}
              type="button"
              aria-pressed={tab === t.tab}
              onClick={() => setTab(t.tab)}
              className={`min-h-11 rounded-lg px-2 text-sm font-medium ${t.investing ? "col-span-3" : "col-span-2"} ${
                tab === t.tab ? "bg-surface shadow-sm" : "text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {missing ? (
            <p className="text-muted">
              {missing}{" "}
              <Link href="/more/accounts" onClick={close} className="underline">
                Add one in More &gt; Accounts
              </Link>
              .
            </p>
          ) : tab === "INVESTMENT" || tab === "PRICE" ? (
            !holdings || holdings.length === 0 ? (
              <p className="text-muted">
                You have no holdings yet.{" "}
                <Link href="/investments" onClick={close} className="underline">
                  Add one in Investments
                </Link>
                .
              </p>
            ) : tab === "PRICE" ? (
              <PriceForm holdings={holdings} today={today} autoFocus onDone={close} />
            ) : (
              <>
                <div className="mb-5 flex gap-1 rounded-xl bg-background p-1">
                  {(["buy", "sell"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={side === s}
                      onClick={() => setSide(s)}
                      className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-medium ${side === s ? "bg-surface shadow-sm" : "text-muted"}`}
                    >
                      {s === "buy" ? "Buy" : "Sell"}
                    </button>
                  ))}
                </div>
                <TradeForm key={side} side={side} holdings={holdings} accounts={accounts} today={today} autoFocus onDone={close} />
              </>
            )
          ) : (
            <TransactionForm
              key={tab}
              kind={tab}
              accounts={accounts}
              categories={categories}
              today={today}
              onDone={close}
            />
          )}
        </div>
      </Sheet>
    </>
  );
}
