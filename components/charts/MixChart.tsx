"use client";

import { type Mix, MIX_LABELS, type MixClass } from "@/lib/finance-core/portfolioMix";
import type { Token } from "./chartParts";
import { DonutChart } from "./DonutChart";

const TOKEN: Record<MixClass, Token> = { stocks: "investments", gold: "spending", clouds: "goals", cash: "cash" };

/** The four classes as a donut with EGP and percent of total assets. */
export function MixChart({ mix }: { mix: Mix }) {
  if (mix.total <= 0) return <p className="text-muted">No assets yet.</p>;
  return (
    <DonutChart
      name="Share of total assets"
      slices={mix.lines.map((l) => ({ label: MIX_LABELS[l.class], value: l.value, bps: l.bps, token: TOKEN[l.class] }))}
    />
  );
}
