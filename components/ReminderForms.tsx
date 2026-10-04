"use client";

import { setReminderSwitches } from "@/app/actions/settings";
import type { ReminderKind } from "@/lib/finance-core/reminders";
import { Form } from "./Form";
import { primaryBtn } from "./ui";

const KINDS: { kind: ReminderKind; label: string; hint: string }[] = [
  { kind: "review", label: "Monthly review is ready", hint: "In the first 7 days of a month, when last month has data." },
  { kind: "recurring", label: "Recurring items are waiting", hint: "Bills and income that need your OK." },
  { kind: "stale", label: "Investment values are out of date", hint: "Prices or confirmed values older than your limit." },
  { kind: "goal", label: "A goal contribution is due", hint: "After the 20th, when you have set aside less than planned." },
  { kind: "budget", label: "A budget is close to its limit or over", hint: "At your warning level, alert level or beyond." },
  { kind: "savings", label: "You missed your savings target last month", hint: "Last full month's savings against your monthly target." },
];

/** One switch per reminder kind; `on` holds the current state of each. */
export function ReminderSwitchesForm({ on }: { on: Record<ReminderKind, boolean> }) {
  return (
    <Form action={setReminderSwitches}>
      {({ pending, saved }) => (
        <>
          <ul className="divide-y divide-border">
            {KINDS.map(({ kind, label, hint }) => (
              <li key={kind}>
                <label className="flex min-h-11 items-start gap-3 py-3">
                  <input type="checkbox" name={kind} defaultChecked={on[kind]} className="mt-1 size-5 shrink-0" />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="block text-sm text-muted">{hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save reminders"}
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
