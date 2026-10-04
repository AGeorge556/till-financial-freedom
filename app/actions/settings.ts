"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { AUTO_LOCK_CHOICES, savingsTargetMode, userSettings } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { parseEGP } from "@/lib/finance-core/money";
import { MIX_CLASSES, type MixClass, validateTargets } from "@/lib/finance-core/portfolioMix";
import { type ActionState, flag, str } from "./shared";

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
  await db.transaction((tx) =>
    tx
      .insert(userSettings)
      .values({ userId, ...fields })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...fields, updatedAt: new Date() } }),
  );
  revalidatePath("/", "layout");
}

/** "My month starts on day N": a whole day from 1 to 28 (the user_settings_month_start_day_range check). */
export async function setMonthStartDay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const text = str(formData, "day");
  const day = /^\d{1,2}$/.test(text) ? Number(text) : 0;
  if (day < 1 || day > 28) return { error: "Choose a day from 1 to 28." };

  await upsert(userId, { monthStartDay: day });
  return {};
}

/** Minutes without activity before the app signs out: one of AUTO_LOCK_CHOICES, or "off" (stored as null). */
export async function setAutoLock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const text = str(formData, "minutes");
  const minutes = text === "off" ? null : Number(text);
  if (minutes !== null && !(AUTO_LOCK_CHOICES as readonly number[]).includes(minutes)) {
    return { error: "Choose off, or 1, 5, 15 or 30 minutes." };
  }

  await upsert(userId, { autoLockMinutes: minutes });
  return {};
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

/** "80" or "12.5" (a percent, one decimal) to whole thousandths of a budget (0.8 = 800); null if malformed or not in (0, 200]. */
function percentToThousandths(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d))?$/.exec(text);
  if (!m) return null;
  const thousandths = Number(m[1] + (m[2] ?? "0")); // percent x 10 = fraction x 1,000
  return thousandths === 0 || thousandths > 2000 ? null : thousandths;
}

const thresholdText = (t: number) => `${Math.trunc(t / 1000)}.${String(t % 1000).padStart(3, "0")}`;

/** B4: the shares of a budget spent at which it warns and alerts (defaults 80 and 100). Warn is at most alert. */
export async function setBudgetThresholds(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const warn = percentToThousandths(str(formData, "warn"));
  const alert = percentToThousandths(str(formData, "alert"));
  if (warn === null || alert === null || warn > alert) {
    return { error: "Enter the warning and alert levels as percents of a budget, like 80 and 100: above 0, up to 200, with the warning no higher than the alert." };
  }

  await upsert(userId, { budgetWarnAt: thresholdText(warn), budgetAlertAt: thresholdText(alert) });
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

/** "40" or "12.5" (a percent, up to 2 decimals) to hundredths of a percent (12.5 -> 1250); null if malformed or above 100. */
function percentToHundredths(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const hundredths = Number(m[1] + (m[2] ?? "").padEnd(2, "0"));
  return hundredths > 10_000 ? null : hundredths;
}

/** P2: the share wanted in each class (fields stocks, gold, clouds, cash, typed like "40"). All four totalling 100, or all blank to clear. */
export async function setPortfolioTargets(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const typed: Partial<Record<MixClass, number>> = {};
  for (const c of MIX_CLASSES) {
    const text = str(formData, c);
    if (text === "") continue;
    const hundredths = percentToHundredths(text);
    if (hundredths === null) return { error: "Enter each target as a percent from 0 to 100, like 40 or 12.5." };
    typed[c] = hundredths / 10_000;
  }
  const check = validateTargets(typed);
  if (!check.ok) return { error: check.error };

  const t = check.targets;
  await upsert(userId, {
    targetStocks: t ? t.stocks.toFixed(5) : null,
    targetGold: t ? t.gold.toFixed(5) : null,
    targetClouds: t ? t.clouds.toFixed(5) : null,
    targetCash: t ? t.cash.toFixed(5) : null,
  });
  return {};
}

/** I3: a spending change is shown only if it reaches both this percent (0-100) and this amount. */
export async function setInsightThresholds(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const percent = percentToHundredths(str(formData, "percent"));
  const amount = parseEGP(str(formData, "amount"));
  if (percent === null) return { error: "Enter the smallest change as a percent from 0 to 100, like 15." };
  if (amount === null) return { error: AMOUNT_ERROR };

  await upsert(userId, { insightMinPercent: (percent / 10_000).toFixed(4), insightMinAmount: amount });
  return {};
}

/** R1: one checkbox per reminder kind (review, recurring, stale, goal, budget, savings); unticked means off. */
export async function setReminderSwitches(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  await upsert(userId, {
    remindReview: flag(formData, "review"),
    remindRecurring: flag(formData, "recurring"),
    remindStale: flag(formData, "stale"),
    remindGoal: flag(formData, "goal"),
    remindBudget: flag(formData, "budget"),
    remindSavings: flag(formData, "savings"),
  });
  return {};
}
