"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { financialAssumptions, userSettings } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { type ActionState, str } from "./shared";

// Expected returns are the user's own figures, labelled expected / assumed wherever they are shown. Blank clears one.
const FIELDS = {
  stockReturn: "Stock return",
  goldReturn: "Gold return",
  savingsCloudApy: "Savings Cloud APY",
  cashReturn: "Cash return",
  inflation: "Inflation",
} as const;

const MIN_DAYS = 1;
const MAX_DAYS = 365;

// ponytail: same conversion as goals.ts (a "use server" file cannot export it); move to shared.ts if a third copy appears.
/** "12.5" or "-7.5" (a percent, up to 4 decimals) to the stored rate string "0.125000"; null if malformed or outside -100..1000 percent. */
function percentToRate(text: string): string | null {
  const m = /^(-)?(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const micro = Number(m[2] + (m[3] ?? "").padEnd(4, "0")); // percent x 10,000 = rate x 1,000,000
  if (micro > 1000 * 10_000 || (m[1] && micro > 100 * 10_000)) return null;
  const sign = m[1] && micro > 0 ? "-" : "";
  return `${sign}${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`;
}

export async function setAssumptions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const rates: Record<keyof typeof FIELDS, string | null> = {
    stockReturn: null,
    goldReturn: null,
    savingsCloudApy: null,
    cashReturn: null,
    inflation: null,
  };
  for (const key of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    const text = str(formData, key);
    if (text === "") continue;
    const rate = percentToRate(text);
    if (rate === null) return { error: `${FIELDS[key]}: enter a percent between -100 and 1000, like 12 or 7.5, or leave it blank.` };
    rates[key] = rate;
  }

  await db
    .insert(financialAssumptions)
    .values({ userId, ...rates })
    .onConflictDoUpdate({ target: financialAssumptions.userId, set: { ...rates, updatedAt: new Date() } });
  revalidatePath("/", "layout");
  return {};
}

/** A holding's price is stale when its latest update is older than this many days. */
export async function setStaleDays(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const text = str(formData, "staleDays");
  const days = /^\d{1,3}$/.test(text) ? Number(text) : 0;
  if (days < MIN_DAYS || days > MAX_DAYS) return { error: `Enter a whole number of days from ${MIN_DAYS} to ${MAX_DAYS}.` };

  // user_settings may not exist yet, so this upserts, like settings.ts.
  await db
    .insert(userSettings)
    .values({ userId, staleDaysHoldings: days })
    .onConflictDoUpdate({ target: userSettings.userId, set: { staleDaysHoldings: days, updatedAt: new Date() } });
  revalidatePath("/", "layout");
  return {};
}
