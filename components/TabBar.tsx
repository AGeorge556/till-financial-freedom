"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Home", color: "text-foreground", d: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  {
    href: "/spending",
    label: "Spending",
    color: "text-spending",
    d: "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zm0 0V6a2 2 0 0 1 2-2h11M16 14h2",
  },
  {
    href: "/goals",
    label: "Goals",
    color: "text-goals",
    d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  },
  {
    href: "/investments",
    label: "Investments",
    color: "text-investments",
    d: "M3 17l6-6 4 4 8-8M15 7h6v6",
  },
  { href: "/more", label: "More", color: "text-foreground", d: "M5 12h.5M11.75 12h.5M18.5 12h.5" },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:right-auto md:w-60 md:border-t-0 md:border-r md:px-3 md:pt-[calc(1.5rem+env(safe-area-inset-top))] md:pb-6 md:pl-[max(0.75rem,env(safe-area-inset-left))]"
    >
      <p className="mb-6 hidden px-3 text-lg font-semibold tracking-tight md:block">Till</p>
      <ul className="grid grid-cols-5 md:flex md:flex-col md:gap-1">
        {tabs.map(({ href, label, color, d }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-14 flex-col focus-visible:outline-offset-[-4px] items-center justify-center gap-0.5 text-xs md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm ${
                  active ? `${color} font-semibold md:bg-background` : "text-muted hover:text-foreground"
                }`}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-current md:hidden" />}
                <svg
                  viewBox="0 0 24 24"
                  className="size-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2 : 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={d} />
                </svg>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
