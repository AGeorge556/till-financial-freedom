import { percentOf } from "./allocation";
import type { Piasters } from "./money";

/** The four asset classes of the mix, in display order. */
export const MIX_CLASSES = ["stocks", "gold", "clouds", "cash"] as const;
export type MixClass = (typeof MIX_CLASSES)[number];

export const MIX_LABELS: Record<MixClass, string> = {
  stocks: "Stocks & funds",
  gold: "Gold",
  clouds: "Savings Clouds",
  cash: "Cash",
};

export type MixLine = {
  class: MixClass;
  value: Piasters;
  /** Share of total assets in hundredths of a percent (3333 = 33.33%). The four lines add up to exactly 10000. */
  bps: number;
  /** bps / 100, for display. */
  percent: number;
};

export type Mix = { total: Piasters; lines: MixLine[] };

/**
 * Value and share of each class. Shares are of total ASSETS, so a negative figure (an overdrawn account) counts as 0.
 * Shares are floored to hundredths of a percent and the leftover hundredths go to the largest fractional parts
 * (ties: display order), so they always total 100.00%. No assets -> all 0.
 */
export function mix(values: Record<MixClass, Piasters>): Mix {
  const value = (c: MixClass) => Math.max(0, values[c]);
  const total = MIX_CLASSES.reduce((s, c) => s + value(c), 0);
  const parts = MIX_CLASSES.map((c) => ({ c, bps: 0, rem: BigInt(0) }));
  if (total > 0) {
    const T = BigInt(total);
    for (const p of parts) {
      const exact = BigInt(value(p.c)) * BigInt(10000);
      p.bps = Number(exact / T);
      p.rem = exact % T;
    }
    let left = 10000 - parts.reduce((s, p) => s + p.bps, 0);
    [...parts]
      .sort((a, b) => (a.rem === b.rem ? 0 : a.rem > b.rem ? -1 : 1))
      .forEach((p) => {
        if (left-- > 0) p.bps += 1;
      });
  }
  return { total, lines: parts.map((p) => ({ class: p.c, value: value(p.c), bps: p.bps, percent: p.bps / 100 })) };
}

export type Targets = Record<MixClass, number>;

export type TargetsCheck = { ok: true; targets: Targets | null } | { ok: false; error: string };

const TOLERANCE = 0.00001;

/** Each class is a decimal fraction (0.4 = 40%). All four unset (null/undefined) = no target; otherwise all four, each 0-1, totalling 100%. */
export function validateTargets(input: Partial<Record<MixClass, number | null>>): TargetsCheck {
  const given = MIX_CLASSES.filter((c) => input[c] != null);
  if (given.length === 0) return { ok: true, targets: null };
  if (given.length < MIX_CLASSES.length) return { ok: false, error: "Set a target for all four classes, or clear them all." };
  const t = Object.fromEntries(MIX_CLASSES.map((c) => [c, input[c] as number])) as Targets;
  if (MIX_CLASSES.some((c) => !Number.isFinite(t[c]) || t[c] < 0 || t[c] > 1)) {
    return { ok: false, error: "Each target must be between 0% and 100%." };
  }
  const total = MIX_CLASSES.reduce((s, c) => s + t[c], 0);
  if (Math.abs(total - 1) > TOLERANCE + 1e-9) return { ok: false, error: "Your targets must add up to 100%." };
  return { ok: true, targets: t };
}

export type TargetLine = MixLine & {
  /** The class's target share, a fraction. */
  target: number;
  /** What the target share of today's total assets is worth. */
  targetValue: Piasters;
  /** value - targetValue: positive = above the target. */
  difference: Piasters;
  direction: "above" | "below" | "on";
};

/** Current against target per class. Information only: nothing here rebalances or suggests a trade. */
export function vsTarget(current: Mix, targets: Targets): TargetLine[] {
  return current.lines.map((l) => {
    const targetValue = percentOf(current.total, targets[l.class]);
    const difference = l.value - targetValue;
    return { ...l, target: targets[l.class], targetValue, difference, direction: difference > 0 ? "above" : difference < 0 ? "below" : "on" };
  });
}
