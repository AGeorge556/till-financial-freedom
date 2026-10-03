import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/login/actions";

export const metadata: Metadata = { title: "More" };

const links = [
  { href: "/more/accounts", title: "Accounts", hint: "Balances, add or archive an account" },
  { href: "/more/categories", title: "Categories", hint: "What you spend on and earn from" },
  { href: "/more/backup", title: "Backup", hint: "Save a copy of your data" },
];

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">More</h1>
      <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
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
      <form action={signOut} className="mt-6">
        <button type="submit" className="min-h-11 w-full rounded-xl border border-border px-4 font-medium">
          Sign out
        </button>
      </form>
    </>
  );
}
