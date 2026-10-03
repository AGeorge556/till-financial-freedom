import type { ReactNode } from "react";
import { card } from "./ui";

/** A label and a value on one line, with an optional smaller hint under the value. */
export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right font-medium">
        {children}
        {hint && <span className="block text-sm font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

/** A collapsed section with a form inside. */
export function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className={card}>
      <summary className="flex min-h-14 cursor-pointer items-center px-5 font-semibold">{title}</summary>
      <div className="border-t border-border p-5">
        {hint && <p className="mb-4 text-sm text-muted">{hint}</p>}
        {children}
      </div>
    </details>
  );
}

export const StaleBadge = () => (
  <span className="ml-2 rounded-full border border-negative px-2 py-0.5 text-xs font-medium text-negative">▲ Stale</span>
);
