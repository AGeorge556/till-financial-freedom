import Link from "next/link";
import type { Reminder } from "@/lib/finance-core/reminders";
import { TextParts } from "./InsightList";

/** Compact list of what needs attention, each with a link. Renders nothing when there are none. */
export function ReminderList({ reminders }: { reminders: Reminder[] }) {
  if (reminders.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold tracking-tight">Reminders</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {reminders.map((r) => (
          <li key={r.id}>
            <Link href={r.href} className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
              <span>
                <TextParts parts={r.text} />
              </span>
              <span aria-hidden="true" className="shrink-0 text-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
