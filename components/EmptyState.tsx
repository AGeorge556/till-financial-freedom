import type { ReactNode } from "react";

const bar = {
  cash: "bg-cash",
  investments: "bg-investments",
  spending: "bg-spending",
  goals: "bg-goals",
} as const;

export function EmptyState({
  accent,
  title,
  items,
  children,
}: {
  accent: keyof typeof bar;
  title: string;
  items: string[];
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <span className={`mb-4 block h-1 w-8 rounded-full ${bar[accent]}`} />
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-muted">{children}</p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item} className="rounded-full border border-border px-3 py-1 text-sm">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
