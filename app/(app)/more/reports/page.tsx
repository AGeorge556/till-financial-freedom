import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "@/components/ui";

export const metadata: Metadata = { title: "Reports" };

const reports = [
  { href: "/more/review", title: "Monthly review", hint: "How a month went: saved, invested, net worth change" },
  { href: "/spending", title: "Spending", hint: "Where the money went, budgets, compared with your usual" },
  { href: "/more/history", title: "Net worth history", hint: "Net worth, cash, investments and debt over time" },
  { href: "/investments", title: "Investments", hint: "Holdings, profit or loss, and your mix against your targets" },
  { href: "/goals", title: "Goals", hint: "Progress, projections and the monthly plan" },
  { href: "/more/backup", title: "Backup export", hint: "Download your data as a file" },
];

export default function Page() {
  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Reports</h1>
      <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {reports.map(({ href, title, hint }) => (
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
    </>
  );
}
