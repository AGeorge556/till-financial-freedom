"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { getWealthSettings } from "@/db/queries";
import { goldPrices } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { KARATS } from "@/lib/finance-core/gold";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, isRealDate, str } from "./shared";

const PRICE_ERROR = "Enter the buy-back price per gram, zero or more with up to 6 decimals, like 4250.50.";
const DATE_ERROR = "Enter a valid date.";

// NUMERIC(20,6): plain digits, at most 14 whole and 6 decimal places. Never Number().
const DECIMAL = /^\d{1,14}(\.\d{1,6})?$/;

// Only the constraint names this file can trip, translated; anything else is a bug and propagates.
const KNOWN_VIOLATIONS: Record<string, string> = {
  gold_prices_karat_check: "Choose 24, 21 or 18 karat.",
  gold_prices_price_check: PRICE_ERROR,
};

function knownViolation(e: unknown): string | undefined {
  const name = (e as { cause?: { constraint_name?: string } })?.cause?.constraint_name;
  return name ? KNOWN_VIOLATIONS[name] : undefined;
}

/**
 * Appends a buy-back price per gram. Gold prices are global, not per holding. In derive_24k mode only the 24K price is
 * entered (the other karats follow from it); in per_karat mode each karat gets its own. Never edits one: a wrong price
 * is fixed by adding a newer one for the same date.
 */
export async function addGoldPrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const price = str(formData, "price");
  if (!DECIMAL.test(price)) return { error: PRICE_ERROR };
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return { error: DATE_ERROR };
  if (date > cairoToday()) return { error: "A price cannot be dated in the future." };
  const karatText = str(formData, "karat");

  let error: string | undefined;
  try {
    error = await db.transaction(async (tx) => {
      const { goldPriceMode } = await getWealthSettings(userId, tx);
      let karat: number | undefined;
      if (goldPriceMode === "derive_24k") {
        if (karatText !== "" && karatText !== "24") {
          return "Prices are entered for 24K and the other karats follow. Change the price mode to enter each karat.";
        }
        karat = 24;
      } else {
        karat = KARATS.find((k) => String(k) === karatText);
        if (karat === undefined) return "Choose 24, 21 or 18 karat.";
      }
      await tx.insert(goldPrices).values({ userId, date, karat, buybackPrice: price, createdAt: new Date() });
    });
  } catch (e) {
    const message = knownViolation(e);
    if (!message) throw e;
    return { error: message };
  }
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}
