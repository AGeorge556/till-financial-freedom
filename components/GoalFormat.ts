// Display-only helpers for the goal screens. No formula here decides a financial result.
import type { Piasters } from "@/lib/finance-core/money";

/** "12%", "7.5%". */
export const formatRate = (rate: number) => `${Number((rate * 100).toFixed(2))}%`;

/** What a person would type back in for a stored rate: 0.075 -> "7.5". */
export const ratePercentText = (rate: number | null) => (rate === null ? "" : String(Number((rate * 100).toFixed(4))));

/** Piasters to the plain decimal a person would type back in ("1250.5"); integer math only. */
export function egpText(piasters: Piasters): string {
  const cents = piasters % 100;
  const whole = Math.trunc(piasters / 100);
  return cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

/** Whole percent for a progress bar; rounds down so 99.9% never reads as done. */
export function progressPercent(current: Piasters, target: Piasters): number {
  return target <= 0 ? 0 : Math.min(100, Math.max(0, Math.floor((current / target) * 100)));
}

export const monthsText = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

/** Months to reach the target minus months left: negative = early, null = not reached at this pace. */
export function monthsLateText(monthsLate: number | null): string {
  if (monthsLate === null) return "not reached at this pace";
  if (monthsLate < 0) return `${monthsText(-monthsLate)} early`;
  if (monthsLate === 0) return "on time";
  return `${monthsText(monthsLate)} late`;
}

/** 'YYYY-MM' moved by whole months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function ruleTargetName(targetKind: "goal" | "investments" | "cash", goalName: string | null): string {
  if (targetKind === "goal") return goalName ?? "A goal";
  return targetKind === "investments" ? "Investments (not tied to a goal)" : "Cash savings (not tied to a goal)";
}

/** A stored share ("0.25", "-0.125") as a person reads and types it: "25", "-12.5". String work only, never a float. */
export function sharePercentText(share: string): string {
  const sign = share.startsWith("-") ? "-" : "";
  const [whole, frac = ""] = share.replace("-", "").split(".");
  const micro = (whole + frac.padEnd(6, "0")).replace(/^0+/, "").padStart(5, "0"); // share x 1,000,000
  const decimals = micro.slice(-4).replace(/0+$/, "");
  return `${sign}${micro.slice(0, -4)}${decimals ? `.${decimals}` : ""}`;
}
