"use client";

import { setAssumptions, setGoldPriceMode, setStaleDays, setStaleDaysClouds, setStaleDaysGold } from "@/app/actions/assumptions";
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

function DaysForm({
  action,
  label,
  days,
}: {
  action: typeof setStaleDays;
  label: string;
  days: number;
}) {
  return (
    <Form action={action}>
      {({ pending, saved }) => (
        <>
          <Field label={label}>
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

export const StaleDaysForm = ({ days }: { days: number }) => (
  <DaysForm action={setStaleDays} label="A stock or fund price is stale after (days)" days={days} />
);
export const StaleDaysGoldForm = ({ days }: { days: number }) => (
  <DaysForm action={setStaleDaysGold} label="A gold price is stale after (days)" days={days} />
);
export const StaleDaysCloudsForm = ({ days }: { days: number }) => (
  <DaysForm action={setStaleDaysClouds} label="A Savings Cloud is stale after its last confirmed value is older than (days)" days={days} />
);

export function GoldModeForm({ mode }: { mode: "derive_24k" | "per_karat" }) {
  return (
    <Form action={setGoldPriceMode}>
      {({ pending, saved }) => (
        <>
          <fieldset>
            <legend className="text-sm text-muted">How do you enter gold prices?</legend>
            {(
              [
                ["derive_24k", "One price: I enter the 24K buy-back price and 21K and 18K follow from it"],
                ["per_karat", "One price per karat: I enter 24K, 21K and 18K myself"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="mt-2 flex min-h-11 items-start gap-3 py-2">
                <input type="radio" name="mode" value={value} defaultChecked={mode === value} className="mt-0.5 size-5" />
                {label}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save"}
          </button>
          {savedNote(saved)}
        </>
      )}
    </Form>
  );
}
