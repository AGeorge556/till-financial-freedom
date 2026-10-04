"use client";

import { useState } from "react";
import { createTemplate, setTemplateActive, updateTemplate } from "@/app/actions/recurring";
import type { Frequency } from "@/lib/finance-core/recurring";
import { Form } from "./Form";
import { GoalSheet } from "./GoalSheet";
import { egpText } from "./GoalFormat";
import { Field, field, primaryBtn, secondaryBtn } from "./ui";

export type RecurringValues = {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  categoryId: string | null;
  accountId: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  autoPost: boolean;
  note: string | null;
};
export type RecurringAccount = { id: string; name: string; archived: boolean };
export type RecurringCategory = { id: string; name: string; kind: "income" | "expense"; archived: boolean };

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
];

function RecurringFields({
  initial,
  accounts,
  categories,
  today,
}: {
  initial?: RecurringValues;
  accounts: RecurringAccount[];
  categories: RecurringCategory[];
  today: string;
}) {
  const [type, setType] = useState<"INCOME" | "EXPENSE">(initial?.type ?? "EXPENSE");
  const kind = type === "INCOME" ? "income" : "expense";
  const usable = <T extends { id: string; archived: boolean }>(options: T[], current: string | null | undefined) =>
    options.filter((o) => !o.archived || o.id === current);

  return (
    <>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <fieldset>
        <legend className="text-sm text-muted">Type</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
            <label key={t}>
              <input
                type="radio"
                name="type"
                value={t}
                checked={type === t}
                onChange={() => setType(t)}
                className="peer sr-only"
              />
              <span className="flex min-h-11 items-center justify-center rounded-xl border border-control text-sm peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground">
                {t === "EXPENSE" ? "Expense (a bill)" : "Income"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Name" className="mt-4">
        <input
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Rent"
          defaultValue={initial?.name}
          data-autofocus=""
          className={field}
        />
      </Field>
      <Field label="Amount (EGP)" className="mt-4">
        <input
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          required
          placeholder="5,000"
          defaultValue={initial ? egpText(initial.amount) : undefined}
          className={field}
        />
      </Field>
      <Field label="Category" className="mt-4">
        {/* Keyed by type so the list and the selection reset when the type changes. */}
        <select
          key={kind}
          name="categoryId"
          required
          defaultValue={initial?.type === type ? (initial.categoryId ?? "") : ""}
          className={field}
        >
          <option value="" disabled>
            Choose a category
          </option>
          {usable(
            categories.filter((c) => c.kind === kind),
            initial?.categoryId,
          ).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label={type === "INCOME" ? "Paid into" : "Paid from"} className="mt-4">
        <select name="accountId" required defaultValue={initial?.accountId ?? accounts.find((a) => !a.archived)?.id} className={field}>
          {usable(accounts, initial?.accountId).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="How often" className="mt-4">
        <select name="frequency" required defaultValue={initial?.frequency ?? "monthly"} className={field}>
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="First date" className="mt-4">
        <input type="date" name="startDate" required defaultValue={initial?.startDate ?? today} className={field} />
      </Field>
      <p className="mt-1 text-sm text-muted">
        A monthly item on the 31st falls on the last day of shorter months.
        {initial ? " Changing this date or how often starts a new schedule, so pick a date after today." : ""}
      </p>
      <Field label="Last date (optional)" className="mt-4">
        <input type="date" name="endDate" defaultValue={initial?.endDate ?? ""} className={field} />
      </Field>
      <label className="mt-4 flex min-h-11 items-center gap-3">
        <input type="checkbox" name="autoPost" defaultChecked={initial?.autoPost ?? false} className="size-5" />
        <span>Post automatically, without asking me</span>
      </label>
      <p className="text-sm text-muted">Otherwise each one waits for your OK in Spending before it counts.</p>
      <Field label="Note (optional, no amounts)" className="mt-4">
        <input name="note" maxLength={500} autoComplete="off" defaultValue={initial?.note ?? ""} className={field} />
      </Field>
    </>
  );
}

export function NewRecurringButton({
  accounts,
  categories,
  today,
}: {
  accounts: RecurringAccount[];
  categories: RecurringCategory[];
  today: string;
}) {
  return (
    <GoalSheet
      trigger="Add recurring item"
      title="New recurring item"
      className="min-h-11 rounded-xl bg-foreground px-4 font-semibold text-background"
    >
      {(close) => (
        <Form action={createTemplate} onSuccess={close}>
          {({ pending }) => (
            <>
              <RecurringFields accounts={accounts} categories={categories} today={today} />
              <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
                {pending ? "Adding…" : "Add item"}
              </button>
            </>
          )}
        </Form>
      )}
    </GoalSheet>
  );
}

export function EditRecurringButton({
  item,
  accounts,
  categories,
  today,
}: {
  item: RecurringValues;
  accounts: RecurringAccount[];
  categories: RecurringCategory[];
  today: string;
}) {
  return (
    <GoalSheet
      trigger={<>Edit<span className="sr-only"> {item.name}</span></>}
      title={`Edit ${item.name}`}
      className={secondaryBtn}
    >
      {(close) => (
        <Form action={updateTemplate} onSuccess={close}>
          {({ pending }) => (
            <>
              <RecurringFields initial={item} accounts={accounts} categories={categories} today={today} />
              <p className="mt-4 text-sm text-muted">
                Changes apply to future items only. Items that already came due stay as they are.
              </p>
              <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
                {pending ? "Saving…" : "Save changes"}
              </button>
            </>
          )}
        </Form>
      )}
    </GoalSheet>
  );
}

/** Pause stops new items; resuming creates the ones missed meanwhile as items waiting for an OK. */
export function RecurringActiveButton({ id, name, active }: { id: string; name: string; active: boolean }) {
  return (
    <Form
      action={setTemplateActive}
      confirm={active ? undefined : "Resume? Items missed while it was paused are added as waiting for your OK, and you can skip each one."}
    >
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <button type="submit" disabled={pending} aria-label={`${active ? "Pause" : "Resume"} ${name}`} className={secondaryBtn}>
            {pending ? "Saving…" : active ? "Pause" : "Resume"}
          </button>
        </>
      )}
    </Form>
  );
}
