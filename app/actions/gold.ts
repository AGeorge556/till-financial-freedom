"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { getWealthSettings } from "@/db/queries";
import { goldPrices } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { replacementStamp } from "@/lib/corrections";
import { KARATS } from "@/lib/finance-core/gold";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, knownViolation, str, type Tx } from "./shared";

const PRICE_ERROR = "Enter the buy-back price per gram, zero or more with up to 6 decimals, like 4250.50.";
const DATE_ERROR = "Enter a valid date.";
const NOT_FOUND = "Gold price not found or already removed.";

// NUMERIC(20,6): plain digits, at most 14 whole and 6 decimal places. Never Number().
const DECIMAL = /^\d{1,14}(\.\d{1,6})?$/;

// Only the constraint names this file can trip, translated; anything else is a bug and propagates.
const KNOWN_VIOLATIONS: Record<string, string> = {
  gold_prices_karat_check: "Choose 24, 21 or 18 karat.",
  gold_prices_price_check: PRICE_ERROR,
};

type Fields = { price: string; date: string; karatText: string };

function readFields(formData: FormData): Fields | string {
  const price = str(formData, "price");
  if (!DECIMAL.test(price)) return PRICE_ERROR;
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return DATE_ERROR;
  if (date > cairoToday()) return "A price cannot be dated in the future.";
  return { price, date, karatText: str(formData, "karat") };
}

/** In derive_24k mode only the 24K price is entered (the other karats follow from it); in per_karat mode each karat gets its own. */
async function pickKarat(tx: Tx, userId: string, karatText: string): Promise<number | string> {
  const { goldPriceMode } = await getWealthSettings(userId, tx);
  if (goldPriceMode === "derive_24k") {
    if (karatText !== "" && karatText !== "24") {
      return "Prices are entered for 24K and the other karats follow. Change the price mode to enter each karat.";
    }
    return 24;
  }
  return KARATS.find((k) => String(k) === karatText) ?? "Choose 24, 21 or 18 karat.";
}

async function run(work: (tx: Tx) => Promise<string | undefined>): Promise<ActionState> {
  let error: string | undefined;
  try {
    error = await db.transaction(work);
  } catch (e) {
    const message = knownViolation(e, KNOWN_VIOLATIONS);
    if (!message) throw e;
    return { error: message };
  }
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Appends a buy-back price per gram. Gold prices are global, not per holding. A wrong one is fixed with editGoldPrice
 * or removeGoldPrice, which void it.
 */
export async function addGoldPrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const fields = readFields(formData);
  if (typeof fields === "string") return { error: fields };

  return run(async (tx) => {
    const karat = await pickKarat(tx, userId, fields.karatText);
    if (typeof karat === "string") return karat;
    await tx.insert(goldPrices).values({ userId, date: fields.date, karat, buybackPrice: fields.price, createdAt: new Date() });
  });
}

/** Edit (replace = true) or remove (false) a gold price: it is voided, and an edit inserts the corrected one. */
async function correct(formData: FormData, replace: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const rowId = id(formData, "id");
  const fields = replace ? readFields(formData) : null;
  if (typeof fields === "string") return { error: fields };
  if (!rowId) return { error: NOT_FOUND };

  return run(async (tx) => {
    // FOR UPDATE: a second edit of the same price waits, then finds it voided and is refused.
    const [old] = await tx
      .select()
      .from(goldPrices)
      .where(and(eq(goldPrices.id, rowId), eq(goldPrices.userId, userId), isNull(goldPrices.voidedAt)))
      .for("update");
    if (!old) return NOT_FOUND;
    const karat = fields ? await pickKarat(tx, userId, fields.karatText) : null;
    if (typeof karat === "string") return karat;
    await tx.update(goldPrices).set({ voidedAt: new Date() }).where(eq(goldPrices.id, old.id));
    if (fields && karat !== null) {
      await tx.insert(goldPrices).values({
        userId,
        date: fields.date,
        karat,
        buybackPrice: fields.price,
        createdAt: replacementStamp(old, fields.date),
      });
    }
  });
}

export async function editGoldPrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correct(formData, true);
}

export async function removeGoldPrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correct(formData, false);
}
