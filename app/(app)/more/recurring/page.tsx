import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { formatDay } from "@/components/dates";
import { EmptyState } from "@/components/EmptyState";
import { EditRecurringButton, NewRecurringButton, RecurringActiveButton, type RecurringValues } from "@/components/RecurringForms";
import { BackLink } from "@/components/ui";
import { listAccounts, listCategories, listPendingRecurring, listRecurringTemplates } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { addDays, dueDates, type Frequency } from "@/lib/finance-core/recurring";
import { cairoToday } from "@/lib/finance-core/time";
import { syncRecurring } from "./sync";

export const metadata: Metadata = { title: "Recurring" };

const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: "Every week", monthly: "Every month", yearly: "Every year" };

export default async function Page() {
  const userId = await requireUserId();
  await syncRecurring(userId);
  const today = cairoToday();
  const [templates, accounts, categories, pending] = await Promise.all([
    listRecurringTemplates(userId),
    listAccounts(userId, { includeArchived: true }),
    listCategories(userId, { includeArchived: true }),
    listPendingRecurring(userId),
  ]);
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name, archived: a.archivedAt !== null }));
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: c.archivedAt !== null }));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const waiting = new Map<string, number>();
  for (const p of pending) waiting.set(p.recurringTemplateId!, (waiting.get(p.recurringTemplateId!) ?? 0) + 1);

  // Everything due up to today already has a row, so the next due date is the first one after today (a year covers every frequency).
  const nextDue = (t: (typeof templates)[number]) => dueDates({ ...t, active: true }, addDays(today, 366)).find((d) => d > today) ?? null;

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Recurring</h1>
        {accounts.some((a) => a.archivedAt === null) && (
          <NewRecurringButton accounts={accountOptions} categories={categoryOptions} today={today} />
        )}
      </div>
      <p className="mt-1 text-muted">
        Bills and income that repeat. Each one appears in{" "}
        <Link href="/spending" className="underline">
          Spending
        </Link>{" "}
        when it is due, and counts once you confirm it.
      </p>

      {templates.length === 0 ? (
        <div className="mt-6">
          <EmptyState accent="spending" title="Nothing repeats yet" items={["Rent", "Salary", "Subscriptions"]}>
            {accounts.some((a) => a.archivedAt === null) ? (
              "Add a bill or income that comes round every week, month or year."
            ) : (
              <>
                Add an account first.{" "}
                <Link href="/more/accounts" className="underline">
                  Open accounts
                </Link>
                .
              </>
            )}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {templates.map((t) => {
            const next = nextDue(t);
            const type = t.type === "INCOME" ? "INCOME" : "EXPENSE";
            const values: RecurringValues = {
              id: t.id,
              name: t.name,
              type,
              amount: t.amount,
              categoryId: t.categoryId,
              accountId: t.accountId,
              frequency: t.frequency,
              startDate: t.startDate,
              endDate: t.endDate,
              autoPost: t.autoPost,
              note: t.note,
            };
            const count = waiting.get(t.id) ?? 0;
            return (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className={`block truncate font-medium ${t.active ? "" : "text-muted"}`}>
                      {t.name}
                      {!t.active && (
                        <span className="ml-2 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-normal">Paused</span>
                      )}
                    </span>
                    <span className="block text-sm text-muted">
                      {FREQUENCY_LABEL[t.frequency]} · {type === "INCOME" ? "into" : "from"} {accountName.get(t.accountId) ?? "?"}
                      {t.categoryId ? ` · ${categoryName.get(t.categoryId) ?? ""}` : ""}
                    </span>
                    <span className="block text-sm text-muted">
                      {!t.active
                        ? "Paused: nothing new is added"
                        : next
                          ? `Next due ${formatDay(next)}`
                          : "Finished: no more dates"}
                      {" · "}
                      {t.autoPost ? "Posts automatically" : "Waits for your OK"}
                    </span>
                    {count > 0 && (
                      <span className="block text-sm">
                        <Link href="/spending" className="underline">
                          {count} waiting for your OK
                        </Link>
                      </span>
                    )}
                  </span>
                  <span className={`shrink-0 font-medium ${type === "INCOME" ? "text-positive" : "text-negative"}`}>
                    {type === "INCOME" ? "+" : "−"}
                    <Amount value={t.amount} />
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <EditRecurringButton item={values} accounts={accountOptions} categories={categoryOptions} today={today} />
                  <RecurringActiveButton id={t.id} name={t.name} active={t.active} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
