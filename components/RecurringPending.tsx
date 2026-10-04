"use client";

import { useState } from "react";
import { confirmRecurring, skipRecurring } from "@/app/actions/recurring";
import { Amount } from "./Amount";
import { formatDay } from "./dates";
import { Form } from "./Form";
import { egpText } from "./GoalFormat";
import { Sheet } from "./Sheet";
import { Field, field, primaryBtn, secondaryBtn } from "./ui";

/** A generated recurring row waiting for the person: amount in piasters. */
export type PendingItem = {
  id: string;
  type: string;
  date: string;
  amount: number;
  category: string | null;
  account: string;
  note: string | null;
};

/** One tap to post it, one to skip it, or change the amount and date first. Skipping is final for that date. */
export function PendingRecurringRow({ item }: { item: PendingItem }) {
  const [changing, setChanging] = useState(false);
  const name = item.note ?? item.category ?? "Recurring item";
  const money = item.type === "INCOME" ? { sign: "+", tone: "text-positive" } : { sign: "−", tone: "text-negative" };
  const idField = <input type="hidden" name="id" value={item.id} />;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block break-words font-medium">{name}</span>
          <span className="block break-words text-sm text-muted">
            Due {formatDay(item.date)} · {item.category ? `${item.category} · ` : ""}
            {item.account}
          </span>
        </span>
        <span className={`shrink-0 font-medium ${money.tone}`}>
          {money.sign}
          <Amount value={item.amount} showPiasters />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <Form action={confirmRecurring}>
          {({ pending }) => (
            <>
              {idField}
              <button
                type="submit"
                disabled={pending}
                aria-label={`Confirm ${name}`}
                className="min-h-11 rounded-xl bg-foreground px-5 font-semibold text-background disabled:opacity-60"
              >
                {pending ? "Confirming…" : "Confirm"}
              </button>
            </>
          )}
        </Form>
        <button type="button" onClick={() => setChanging(true)} aria-label={`Change ${name} before confirming`} className={secondaryBtn}>
          Change
        </button>
        <Form action={skipRecurring} confirm="Skip this one? It will not come back for this date.">
          {({ pending }) => (
            <>
              {idField}
              <button type="submit" disabled={pending} aria-label={`Skip ${name}`} className={secondaryBtn}>
                {pending ? "Skipping…" : "Skip"}
              </button>
            </>
          )}
        </Form>
      </div>

      <Sheet open={changing} onClose={() => setChanging(false)} label={`Confirm ${name}`}>
        <h2 className="mr-11 mb-5 text-lg font-semibold tracking-tight">Confirm {name}</h2>
        <Form action={confirmRecurring} onSuccess={() => setChanging(false)}>
          {({ pending }) => (
            <>
              {idField}
              <Field label="Amount (EGP)">
                <input
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  defaultValue={egpText(item.amount)}
                  data-autofocus=""
                  className={field}
                />
              </Field>
              <Field label="Date" className="mt-4">
                <input type="date" name="date" required defaultValue={item.date} className={field} />
              </Field>
              <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
                {pending ? "Confirming…" : "Confirm"}
              </button>
            </>
          )}
        </Form>
      </Sheet>
    </div>
  );
}

/** The "waiting for you" list at the top of Spending. Nothing is rendered when nothing waits. */
export function RecurringPendingList({ items }: { items: PendingItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="pending-heading" className="mt-6">
      <h2 id="pending-heading" className="text-lg font-semibold tracking-tight">
        Waiting for your OK
      </h2>
      <p className="mt-1 mb-2 text-sm text-muted">
        Recurring items that came due. They do not count anywhere until you confirm them.
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id}>
            <PendingRecurringRow item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
