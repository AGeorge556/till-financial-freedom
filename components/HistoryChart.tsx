"use client";

import Link from "next/link";
import { useState } from "react";
import type { HistoryPoint } from "@/lib/finance-core/history";
import { Amount } from "./Amount";
import { LineChart } from "./charts/LineChart";
import type { Token } from "./charts/chartParts";
import { formatDay } from "./dates";
import { card } from "./ui";

type Key = "netWorth" | "cash" | "investments" | "debt";

const SERIES: { key: Key; label: string; noun: string; token: Token }[] = [
  { key: "netWorth", label: "Net worth", noun: "Your net worth", token: "foreground" },
  { key: "cash", label: "Cash", noun: "Your cash", token: "cash" },
  { key: "investments", label: "Investments", noun: "Your investments", token: "investments" },
  { key: "debt", label: "Debt", noun: "Your debt", token: "spending" },
];

const dayYear = (date: string) => `${formatDay(date)} ${date.slice(0, 4)}`;

/** One series at a time as a step line, with the change over the range in words. Points are plain data from the server. */
export function HistoryChart({ points }: { points: HistoryPoint[] }) {
  const [key, setKey] = useState<Key>("netWorth");
  const s = SERIES.find((x) => x.key === key)!;
  const first = points[0];
  const last = points[points.length - 1];
  const diff = last[key] - first[key];
  const staleNote = last.stale && (key === "netWorth" || key === "investments");

  return (
    <section className={`mt-6 p-5 ${card}`}>
      <div role="group" aria-label="What to show" className="flex flex-wrap gap-2">
        {SERIES.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={x.key === key}
            onClick={() => setKey(x.key)}
            className={`min-h-11 rounded-xl border px-4 font-medium ${x.key === key ? "border-foreground bg-foreground text-background" : "border-border"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-muted">{s.label} now</p>
      <Amount value={last[key]} className="block text-3xl font-semibold tracking-tight" />
      {staleNote && (
        <p role="status" className="mt-1 text-sm text-negative">
          ▲ Some investment values are out of date, so this figure may be off.{" "}
          <Link href="/investments" className="underline">
            Update them
          </Link>
        </p>
      )}

      <div className="mt-4">
        <LineChart name={s.label} token={s.token} points={points.map((p) => ({ date: p.date, value: p[key] }))} />
      </div>

      {points.length > 1 && (
        <p className="mt-4">
          From {dayYear(first.date)} to {dayYear(last.date)} {s.noun.toLowerCase()}{" "}
          {diff === 0 ? (
            "did not change"
          ) : (
            <>
              went {diff > 0 ? "up" : "down"} by <Amount value={Math.abs(diff)} />
            </>
          )}
          <span className="block text-sm text-muted">
            <Amount value={first[key]} /> then, <Amount value={last[key]} /> now.
          </span>
        </p>
      )}
    </section>
  );
}
