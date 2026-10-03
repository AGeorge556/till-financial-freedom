"use client";

import Link from "next/link";
import { useState } from "react";
import { CloudFlowForm } from "./CloudForms";
import { type HoldingOption, PriceForm, TradeForm } from "./HoldingForms";
import { Sheet } from "./Sheet";
import { type AccountOption, type CategoryOption, type Kind, TransactionForm } from "./TransactionForm";
import { Field, field } from "./ui";

type Tab = Kind | "INVESTMENT" | "PRICE";

const TABS: { tab: Tab; label: string; investing?: boolean }[] = [
  { tab: "EXPENSE", label: "Expense" },
  { tab: "INCOME", label: "Income" },
  { tab: "TRANSFER", label: "Transfer" },
  { tab: "INVESTMENT", label: "Investment", investing: true },
  { tab: "PRICE", label: "Price update", investing: true },
];

const holdingLabel = (h: HoldingOption) =>
  `${h.ticker ? `${h.name} (${h.ticker})` : h.name}${h.kind === "gold" ? " (gold)" : h.kind === "cloud" ? " (Savings Cloud)" : ""}`;

/**
 * Floating + button and the sheet it opens. Accounts and categories come from the layout (active ones only).
 * The investing tabs appear only when the layout passes `holdings` (active holdings, possibly none, with their `kind`:
 * a Savings Cloud takes deposits and withdrawals, gold is bought by the gram, and neither is priced per holding).
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
  const [holdingId, setHoldingId] = useState("");
  const close = () => setOpen(false);
  const tabs = TABS.filter((t) => !t.investing || holdings !== undefined);
  const picked = holdings?.find((h) => h.id === holdingId) ?? holdings?.[0];
  const cloud = picked?.kind === "cloud";
  const priceable = (holdings ?? []).filter((h) => h.kind !== "gold" && h.kind !== "cloud");

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
              priceable.length === 0 ? (
                <p className="text-muted">
                  Gold is priced from the gold prices and a Savings Cloud from its confirmed value, not per holding.{" "}
                  <Link href="/investments" onClick={close} className="underline">
                    Update them in Investments
                  </Link>
                  .
                </p>
              ) : (
                <PriceForm holdings={priceable} today={today} autoFocus onDone={close} />
              )
            ) : (
              <>
                {holdings.length > 1 && (
                  <Field label="Holding" className="mb-5">
                    <select value={picked!.id} onChange={(e) => setHoldingId(e.target.value)} className={field}>
                      {holdings.map((h) => (
                        <option key={h.id} value={h.id}>
                          {holdingLabel(h)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="mb-5 flex gap-1 rounded-xl bg-background p-1">
                  {(["buy", "sell"] as const).map((sd) => (
                    <button
                      key={sd}
                      type="button"
                      aria-pressed={side === sd}
                      onClick={() => setSide(sd)}
                      className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-medium ${side === sd ? "bg-surface shadow-sm" : "text-muted"}`}
                    >
                      {cloud ? (sd === "buy" ? "Deposit" : "Withdraw") : sd === "buy" ? "Buy" : "Sell"}
                    </button>
                  ))}
                </div>
                {cloud ? (
                  <CloudFlowForm
                    key={`${picked!.id}-${side}`}
                    side={side === "buy" ? "deposit" : "withdraw"}
                    holdingId={picked!.id}
                    accountId={picked!.accountId}
                    accounts={accounts}
                    today={today}
                    autoFocus
                    onDone={close}
                  />
                ) : (
                  <TradeForm key={`${picked!.id}-${side}`} side={side} holdings={[picked!]} accounts={accounts} today={today} autoFocus onDone={close} />
                )}
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
