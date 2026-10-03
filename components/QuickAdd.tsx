"use client";

import Link from "next/link";
import { useState } from "react";
import { Sheet } from "./Sheet";
import { type AccountOption, type CategoryOption, type Kind, TransactionForm } from "./TransactionForm";

const TABS: { kind: Kind; label: string }[] = [
  { kind: "EXPENSE", label: "Expense" },
  { kind: "INCOME", label: "Income" },
  { kind: "TRANSFER", label: "Transfer" },
];

/** Floating + button and the sheet it opens. Accounts and categories come from the layout (active ones only). */
export function QuickAdd({
  accounts,
  categories,
  today,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const close = () => setOpen(false);

  const missing =
    accounts.length === 0
      ? "You need an account before you can record anything."
      : kind === "TRANSFER" && accounts.length < 2
        ? "A transfer needs two accounts."
        : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKind("EXPENSE");
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
        <div className="mr-11 flex gap-1 rounded-xl bg-background p-1">
          {TABS.map((t) => (
            <button
              key={t.kind}
              type="button"
              aria-pressed={kind === t.kind}
              onClick={() => setKind(t.kind)}
              className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-medium ${
                kind === t.kind ? "bg-surface shadow-sm" : "text-muted"
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
          ) : (
            <TransactionForm
              key={kind}
              kind={kind}
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
