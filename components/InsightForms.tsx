"use client";

import { setInsightThresholds } from "@/app/actions/settings";
import { Form } from "./Form";
import { Field, field, primaryBtn } from "./ui";

/** `percent` and `amount` are as a person types them ("15", "500"). */
export function InsightThresholdsForm({ percent, amount }: { percent: string; amount: string }) {
  return (
    <Form action={setInsightThresholds}>
      {({ pending, saved }) => (
        <>
          <Field label="Smallest change to show (%)">
            <input name="percent" inputMode="decimal" autoComplete="off" required defaultValue={percent} className={field} />
          </Field>
          <Field label="Smallest change to show (EGP)" className="mt-4">
            <input name="amount" inputMode="decimal" autoComplete="off" required defaultValue={amount} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && (
            <p role="status" className="mt-3 text-positive">
              Saved.
            </p>
          )}
        </>
      )}
    </Form>
  );
}
