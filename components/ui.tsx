import Link from "next/link";
import type { ReactNode } from "react";

export const field =
  "mt-2 block min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-foreground";
export const primaryBtn =
  "min-h-12 w-full rounded-xl bg-foreground px-4 font-semibold text-background disabled:opacity-60";
export const secondaryBtn = "min-h-11 rounded-xl border border-border px-4 font-medium disabled:opacity-60";
export const card = "rounded-2xl border border-border bg-surface";

/** Wrapping label: no ids needed, so the same form can appear twice on a page. */
export function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-ml-2 inline-flex min-h-11 items-center px-2 text-sm text-muted hover:text-foreground">
      ‹ {children}
    </Link>
  );
}
