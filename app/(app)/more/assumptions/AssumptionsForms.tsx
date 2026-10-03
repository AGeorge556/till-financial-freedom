"use client";

import { setAssumptions, setStaleDays } from "@/app/actions/assumptions";
import { Form } from "@/components/Form";
import { Field, field, primaryBtn } from "@/components/ui";

const FIELDS = [
  { name: "stockReturn", label: "Stock return a year (%)" },
  { name: "goldReturn", label: "Gold return a year (%)" },
  { name: "savingsCloudApy", label: "Savings Cloud yearly rate, APY (%)" },
  { name: "cashReturn", label: "Cash return a year (%)" },
  { name: "inflation", label: "Inflation a year (%)" },
] as const;

type Key = (typeof FIELDS)[number]["name"];

const savedNote = (saved: boolean) =>
  saved && (
    <p role="status" className="mt-3 text-positive">
      Saved.
    </p>
  );

/** `values` are the percents as a person types them ("7.5"); blank means not set. */
export function AssumptionsForm({ values }: { values: Record<Key, string> }) {
  return (
    <Form action={setAssumptions}>
      {({ pending, saved }) => (
        <>
          {FIELDS.map(({ name, label }, i) => (
            <Field key={name} label={label} className={i > 0 ? "mt-4" : ""}>
              <input name={name} inputMode="decimal" autoComplete="off" placeholder="Not set" defaultValue={values[name]} className={field} />
              <span className="mt-1 block text-sm text-muted">Expected / assumed, not guaranteed.</span>
            </Field>
          ))}
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save assumptions"}
          </button>
          {savedNote(saved)}
        </>
      )}
    </Form>
  );
}

export function StaleDaysForm({ days }: { days: number }) {
  return (
    <Form action={setStaleDays}>
      {({ pending, saved }) => (
        <>
          <Field label="A price is stale after (days)">
            <input name="staleDays" inputMode="numeric" autoComplete="off" required defaultValue={days} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save"}
          </button>
          {savedNote(saved)}
        </>
      )}
    </Form>
  );
}
