"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addExpense, addIncome, addTransfer, editTransaction, voidTransaction } from "@/app/actions/transactions";
import type { ActionState } from "@/app/actions/shared";
import { RemoveButton } from "./Correct";
import { Form } from "./Form";
import { dateText } from "./HoldingFormat";
import { Field, field, primaryBtn } from "./ui";

export type Kind = "EXPENSE" | "INCOME" | "TRANSFER";
export type AccountOption = { id: string; name: string; archived: boolean };
export type CategoryOption = { id: string; name: string; kind: "income" | "expense"; archived: boolean };
/** A saved transaction being edited; amount is piasters. */
export type TxInitial = {
  id: string;
  amount: number;
  date: string;
  note: string | null;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
};

const ADD = { EXPENSE: addExpense, INCOME: addIncome, TRANSFER: addTransfer };
const storageKey = (kind: Kind, role: "from" | "to") => `till:lastAccount:${kind}:${role}`;

/** Piasters to the plain decimal a person would type back in ("1250.5"); integer math only. */
function amountText(piasters: number): string {
  const cents = piasters % 100;
  const whole = Math.trunc(piasters / 100);
  return cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

/** Selected account: the one being edited, else the last one used for this form, else the first active one. */
function useAccountChoice(key: string, options: AccountOption[], initialId: string | null, avoid?: string) {
  const [saved, setSaved] = useState(initialId ?? "");
  useEffect(() => {
    if (initialId) return;
    try {
      const last = localStorage.getItem(key);
      if (last) setSaved(last);
    } catch {}
  }, [key, initialId]);
  const usable = (id: string) => id !== avoid && options.some((o) => o.id === id);
  const choice = usable(saved) ? saved : (options.find((o) => !o.archived && o.id !== avoid)?.id ?? "");
  return [choice, setSaved] as const;
}

function AccountSelect({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: AccountOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Field label={label} className="mt-5">
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)} required className={field}>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.archived ? " (archived)" : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TransactionForm({
  kind,
  accounts,
  categories,
  today,
  initial,
  onDone,
}: {
  kind: Kind;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
  initial?: TxInitial;
  onDone: () => void;
}) {
  const editing = initial !== undefined;
  const [fromId, setFromId] = useAccountChoice(storageKey(kind, "from"), accounts, initial?.fromAccountId ?? null);
  const [toId, setToId] = useAccountChoice(
    storageKey(kind, "to"),
    accounts,
    initial?.toAccountId ?? null,
    kind === "TRANSFER" ? fromId : undefined,
  );

  const categoryKind = kind === "INCOME" ? "income" : "expense";
  const chips = categories.filter((c) => c.kind === categoryKind && (!c.archived || c.id === initial?.categoryId));

  async function save(prev: ActionState, formData: FormData): Promise<ActionState> {
    const result = await (editing ? editTransaction : ADD[kind])(prev, formData);
    if (!result.error && !editing) {
      for (const role of ["from", "to"] as const) {
        const value = formData.get(`${role}AccountId`);
        if (typeof value !== "string") continue;
        try {
          localStorage.setItem(storageKey(kind, role), value);
        } catch {}
      }
    }
    return result;
  }

  return (
    <>
      <Form action={save} onSuccess={onDone}>
        {({ pending }) => (
          <>
            {editing && <input type="hidden" name="id" value={initial.id} />}
            <Field label="Amount (EGP)">
              <input
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                required
                autoFocus={!editing}
                data-autofocus={editing ? undefined : ""}
                defaultValue={editing ? amountText(initial.amount) : undefined}
                className={`${field} min-h-16 text-4xl font-semibold tabular-nums`}
              />
            </Field>

            {kind !== "TRANSFER" && (
              <fieldset className="mt-5">
                <legend className="text-sm text-muted">Category</legend>
                {chips.length === 0 ? (
                  <p className="mt-2 text-muted">
                    No {categoryKind} categories yet.{" "}
                    <Link href="/more/categories" onClick={onDone} className="underline">
                      Add one in More &gt; Categories
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {chips.map((c) => (
                      <label key={c.id}>
                        <input
                          type="radio"
                          name="categoryId"
                          value={c.id}
                          required
                          defaultChecked={c.id === initial?.categoryId}
                          className="peer sr-only"
                        />
                        <span className="flex min-h-11 items-center rounded-full border border-control px-4 text-sm peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground">
                          {c.name}
                          {c.archived ? " (archived)" : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            {kind !== "INCOME" && (
              <AccountSelect
                label={kind === "TRANSFER" ? "From account" : "Paid from"}
                name="fromAccountId"
                options={accounts}
                value={fromId}
                onChange={setFromId}
              />
            )}
            {kind !== "EXPENSE" && (
              <AccountSelect
                label={kind === "TRANSFER" ? "To account" : "Paid into"}
                name="toAccountId"
                options={accounts}
                value={toId}
                onChange={setToId}
              />
            )}

            <Field label="Date" className="mt-5">
              <input type="date" name="date" required defaultValue={initial?.date ?? today} className={field} />
            </Field>
            <Field label="Note (optional)" className="mt-5">
              <input name="note" autoComplete="off" maxLength={500} defaultValue={initial?.note ?? ""} className={field} />
            </Field>

            <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
              {pending ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </Form>

      {editing && (
        <RemoveButton
          action={voidTransaction}
          id={initial.id}
          noun={kind.toLowerCase()}
          what={`${kind.toLowerCase()} of ${dateText(initial.date)}`}
          onDone={onDone}
        />
      )}
    </>
  );
}
