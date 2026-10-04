"use client";

import { removeBudget, setBudget } from "@/app/actions/budgets";
import { setBudgetThresholds } from "@/app/actions/settings";
import { Form } from "./Form";
import { egpText } from "./GoalFormat";
import { Field, field, primaryBtn } from "./ui";

const save = "min-h-11 shrink-0 rounded-xl bg-foreground px-4 font-semibold text-background disabled:opacity-60";

const saved = (done: boolean) =>
  done && (
    <p role="status" className="mt-2 text-sm text-positive">
      Saved.
    </p>
  );

/** Sets (or changes) one standing monthly budget: the overall one when `categoryId` is null. Remove clears it. */
export function BudgetForm({
  categoryId,
  label,
  current,
}: {
  categoryId: string | null;
  label: string;
  current: { id: string; amount: number } | null;
}) {
  return (
    // Keyed by the stored amount so the box shows the new figure after a save or a removal.
    <div key={current?.amount ?? "none"}>
      <Form action={setBudget}>
        {({ pending, saved: done }) => (
          <>
            <input type="hidden" name="categoryId" value={categoryId ?? ""} />
            <div className="flex items-end gap-2">
              <Field label={label} className="min-w-0 flex-1">
                <input
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  placeholder="No budget"
                  defaultValue={current ? egpText(current.amount) : ""}
                  className={field}
                />
              </Field>
              <button type="submit" disabled={pending} className={save}>
                {pending ? "Saving…" : "Save"}
                <span className="sr-only"> {label}</span>
              </button>
            </div>
            {saved(done)}
          </>
        )}
      </Form>
      {current && (
        <Form action={removeBudget} confirm="Remove this budget? Your spending stays as it is.">
          {({ pending }) => (
            <>
              <input type="hidden" name="id" value={current.id} />
              <button type="submit" disabled={pending} className="mt-1 min-h-11 text-sm text-negative underline disabled:opacity-60">
                {pending ? "Removing…" : "Remove budget"}
                <span className="sr-only"> {label}</span>
              </button>
            </>
          )}
        </Form>
      )}
    </div>
  );
}

/** Percents of a budget spent at which it warns and alerts, as a person types them ("80"). */
export function BudgetThresholdsForm({ warn, alert }: { warn: string; alert: string }) {
  return (
    <Form action={setBudgetThresholds}>
      {({ pending, saved: done }) => (
        <>
          <Field label="Warn me at (% of a budget spent)">
            <input name="warn" inputMode="decimal" autoComplete="off" required defaultValue={warn} className={field} />
          </Field>
          <Field label="Alert me at (% of a budget spent)" className="mt-4">
            <input name="alert" inputMode="decimal" autoComplete="off" required defaultValue={alert} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save levels"}
          </button>
          {saved(done)}
        </>
      )}
    </Form>
  );
}
