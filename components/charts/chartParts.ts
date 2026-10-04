"use client";

import { formatEGP, type Piasters } from "@/lib/finance-core/money";
import { usePrivacy } from "../PrivacyProvider";

export type Token = "cash" | "investments" | "spending" | "goals" | "foreground" | "muted";

/** Amounts in a chart's aria-label go through here so privacy mode silences them too. */
export function useMoney() {
  const { hidden } = usePrivacy();
  return { hidden, money: (v: Piasters) => (hidden ? "a hidden amount" : formatEGP(v)) };
}

export const HIDDEN_NOTE = "Amounts are hidden, so the chart shows only its shape.";
