"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { savingsTargetMode, userSettings } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { parseEGP } from "@/lib/finance-core/money";
import { type ActionState, str } from "./shared";

const AMOUNT_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign).";

type Mode = (typeof savingsTargetMode.enumValues)[number];

/** "20" or "12.5" (a percent, up to 4 decimals) to the stored rate string "0.200000"; null if malformed or not in (0, 100]. */
function percentToRate(text: string): string | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const micro = Number(m[1] + (m[2] ?? "").padEnd(4, "0")); // percent x 10,000 = rate x 1,000,000
  if (micro === 0 || micro > 1_000_000) return null;
  return `${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`;
}

// user_settings may not exist yet (getSettings falls back to defaults), so these upsert.
async function upsert(userId: string, fields: Partial<typeof userSettings.$inferInsert>) {
  await db
    .insert(userSettings)
    .values({ userId, ...fields })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...fields, updatedAt: new Date() } });
  revalidatePath("/", "layout");
}

/** Rule G. Only the figure the chosen mode uses is kept; "flexible" keeps none. */
export async function setSavingsTarget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const mode = str(formData, "mode") as Mode;
  if (!savingsTargetMode.enumValues.includes(mode)) return { error: "Choose fixed, percentage of income, or flexible." };

  let amount: number | null = null;
  let percent: string | null = null;
  if (mode === "fixed") {
    amount = parseEGP(str(formData, "amount"));
    if (amount === null) return { error: AMOUNT_ERROR };
  } else if (mode === "percentage") {
    percent = percentToRate(str(formData, "percent"));
    if (percent === null) return { error: "Enter a percent above 0 and up to 100, like 20 or 12.5." };
  }

  await upsert(userId, { savingsTargetMode: mode, savingsTargetAmount: amount, savingsTargetPercent: percent });
  return {};
}

/** Rule H: the figures used until 3 full financial months of history exist. Blank clears one. */
export async function setExpectedMonthly(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  // null = left blank, undefined = not an amount
  const read = (key: string) => {
    const text = str(formData, key);
    return text === "" ? null : (parseEGP(text) ?? undefined);
  };
  const income = read("income");
  const spending = read("spending");
  if (income === undefined || spending === undefined) return { error: AMOUNT_ERROR };

  await upsert(userId, { expectedMonthlyIncome: income, expectedMonthlySpending: spending });
  return {};
}
