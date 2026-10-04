"use client";

import { setAutoLock, setMonthStartDay } from "@/app/actions/settings";
import { Form } from "@/components/Form";
import { Field, field, primaryBtn } from "@/components/ui";

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function Saved({ saved }: { saved: boolean }) {
  return saved ? (
    <p role="status" className="mt-3 text-positive">
      Saved.
    </p>
  ) : null;
}

export function MonthStartForm({ day }: { day: number }) {
  return (
    <Form action={setMonthStartDay}>
      {({ pending, saved }) => (
        <>
          <Field label="My month starts on day">
            <select name="day" defaultValue={day} className={field}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save"}
          </button>
          <Saved saved={saved} />
        </>
      )}
    </Form>
  );
}

/** `minutes` is the stored value (null = off); `choices` the minutes offered besides off. */
export function AutoLockForm({ minutes, choices }: { minutes: number | null; choices: readonly number[] }) {
  return (
    <Form action={setAutoLock}>
      {({ pending, saved }) => (
        <>
          <Field label="Sign me out after">
            <select name="minutes" defaultValue={minutes === null ? "off" : minutes} className={field}>
              <option value="off">Never (off)</option>
              {choices.map((m) => (
                <option key={m} value={m}>
                  {m === 1 ? "1 minute" : `${m} minutes`} without use
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save"}
          </button>
          <Saved saved={saved} />
        </>
      )}
    </Form>
  );
}
