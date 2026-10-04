import type { Metadata } from "next";
import Link from "next/link";
import { PasskeySettings } from "@/components/PasskeySettings";
import { BackLink, card } from "@/components/ui";
import { getSettings } from "@/db/queries";
import { AUTO_LOCK_CHOICES } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { passkeysEnabled } from "@/lib/supabase/settings";
import { AutoLockForm, MonthStartForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Settings" };

const links = [
  { href: "/more/assumptions", title: "Assumptions", hint: "Expected returns, gold prices and when a value counts as old" },
  { href: "/more/reminders", title: "Reminders", hint: "Which reminders show on Home, and how small a change to hide" },
  { href: "/more/budgets", title: "Budget thresholds", hint: "When a budget warns you, and when it alerts" },
];

export default async function Page() {
  const userId = await requireUserId();
  const [{ monthStartDay, autoLockMinutes }, passkeys] = await Promise.all([getSettings(userId), passkeysEnabled()]);

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">My month</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            Your month runs from this day to the day before it in the next month. If you are paid on the 25th, choose 25.
            Budgets, the monthly review, the monthly plan and the averages all use it. Changing it moves the month
            boundaries for your past records too; nothing you entered is changed.
          </p>
          <MonthStartForm day={monthStartDay} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Auto-lock</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            Signs you out when you have not touched the app for this long, and when you open it again after being away
            that long. You then sign in again. It is on by default, at 5 minutes.
          </p>
          <AutoLockForm minutes={autoLockMinutes} choices={AUTO_LOCK_CHOICES} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Face ID and passkeys</h2>
        <div className={`p-5 ${card}`}>
          {passkeys ? (
            <PasskeySettings />
          ) : (
            <p className="text-sm text-muted">Face ID sign-in is not switched on for this account yet.</p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">More settings</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {links.map(({ href, title, hint }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="block text-sm text-muted">{hint}</span>
                </span>
                <span aria-hidden="true" className="text-muted">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
