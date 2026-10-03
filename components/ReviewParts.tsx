import type { ReactNode } from "react";
import type { Change } from "@/lib/finance-core/analytics";
import { Amount } from "./Amount";
import { card } from "./ui";

/** "60%", "−5%", or a dash when there is no income to compare with. */
export function percentText(rate: number | null): string {
  if (rate === null) return "—";
  const percent = Math.round(rate * 100);
  return `${percent < 0 ? "−" : ""}${Math.abs(percent)}%`;
}

/** An amount with an explicit + for gains and a colour; the sign is text, so privacy mode still hides the figure itself. */
export function Signed({ value, className = "" }: { value: number; className?: string }) {
  const tone = value > 0 ? "text-positive" : value < 0 ? "text-negative" : "";
  return (
    <span className={`${tone} ${className}`}>
      {value > 0 ? "+" : ""}
      <Amount value={value} />
    </span>
  );
}

export function ReviewSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <dl className={`mt-2 divide-y divide-border px-4 ${card}`}>{children}</dl>
    </section>
  );
}

/** One label and figure, with an optional indented line underneath. */
export function ReviewLine({
  label,
  note,
  strong,
  indent,
  children,
}: {
  label: string;
  note?: ReactNode;
  strong?: boolean;
  indent?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`py-3 ${indent ? "pl-4" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className={strong ? "font-semibold" : indent ? "text-sm text-muted" : ""}>{label}</dt>
        <dd className={`shrink-0 ${strong ? "text-xl font-semibold tracking-tight" : "font-medium"}`}>{children}</dd>
      </div>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  );
}

/** "about 12% above", "about 8% below", "the same as". */
export function changeWords(c: Change): string {
  if (c.absolute === 0) return "the same as";
  const direction = c.absolute > 0 ? "above" : "below";
  return c.percent === null ? direction : `about ${Math.round(Math.abs(c.percent) * 100)}% ${direction}`;
}
