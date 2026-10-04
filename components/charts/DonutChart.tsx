"use client";

import type { Piasters } from "@/lib/finance-core/money";
import { Amount } from "../Amount";
import type { Token } from "./chartParts";

export type Slice = { label: string; value: Piasters; bps: number; token: Token };

const R = 15.9155; // circumference 100, so a slice's length is its percent
const bpsText = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** Shares of a whole (bps add up to 10000). The legend names every slice, so colour is never the only cue. */
export function DonutChart({ name, slices }: { name: string; slices: Slice[] }) {
  let start = 0;
  const arcs = slices.map((s) => {
    const arc = { ...s, len: s.bps / 100, start };
    start += arc.len;
    return arc;
  });
  const label = `${name}: ${slices.map((s) => `${s.label} ${bpsText(s.bps)}`).join(", ")}.`;

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <svg viewBox="0 0 42 42" role="img" aria-label={label} className="size-36 shrink-0 -rotate-90">
        <circle cx={21} cy={21} r={R} fill="none" stroke="var(--border)" strokeWidth={6} />
        {arcs
          .filter((a) => a.len > 0)
          .map((a) => (
            <circle
              key={a.label}
              cx={21}
              cy={21}
              r={R}
              fill="none"
              stroke={`var(--${a.token})`}
              strokeWidth={6}
              strokeDasharray={`${a.len} ${100 - a.len}`}
              strokeDashoffset={-a.start}
            />
          ))}
      </svg>
      <ul className="min-w-0 flex-1 basis-48 space-y-3">
        {slices.map((s) => (
          <li key={s.label} className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-sm" style={{ background: `var(--${s.token})` }} />
            <span className="min-w-0">
              <span className="block font-medium">{s.label}</span>
              <span className="block text-sm text-muted">
                <Amount value={s.value} /> · {bpsText(s.bps)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
