import { lineValue } from "./holdings";
import type { Piasters } from "./money";
import { type HoldingEvent, type PriceUpdate, priceAsOf } from "./portfolio";

/**
 * Physical gold: a holding measured in grams. Purchases are ordinary purchase events (quantity = grams, price = metal
 * price per gram for the karat, fee = workmanship), so replayHolding does the cost basis. Value uses the BUY-BACK price.
 */
export const KARATS = [24, 21, 18] as const;
export type Karat = (typeof KARATS)[number];
export type GoldPriceMode = "derive_24k" | "per_karat";

/** Buy-back price per gram, a 6-decimal string. Global, not per holding. */
export type GoldPrice = { date: string; karat: Karat; price: string; createdAt: string };

/** Default for user_settings.stale_days_gold. */
export const DEFAULT_STALE_DAYS_GOLD = 14;

// BigInt() calls, not 1n literals: tsconfig targets below ES2020. Same fixed-point as holdings.ts.
const SCALE = BigInt(1000000);
const DECIMAL = /^\d+(\.\d{1,6})?$/;

function toScaled(value: string): bigint {
  if (!DECIMAL.test(value)) throw new RangeError(`price must be a non-negative decimal with at most 6 places: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(6, "0"));
}

function fromScaled(n: bigint): string {
  const frac = (n % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${n / SCALE}${frac ? "." + frac : ""}`;
}

function checkKarat(karat: number): asserts karat is Karat {
  if (!(KARATS as readonly number[]).includes(karat)) throw new RangeError(`Karat must be 24, 21 or 18: ${karat}`);
}

/** price24 x karat / 24 in exact fixed-point, rounded half up once at the 6th decimal. 21K and 18K are exact to 3 decimals. */
export function karatPrice(price24: string, karat: Karat): string {
  checkKarat(karat);
  const TWO = BigInt(2);
  const d = BigInt(24);
  return fromScaled((TWO * toScaled(price24) * BigInt(karat) + d) / (TWO * d));
}

/**
 * The price history a gold holding of this karat is valued from, in the shape priceAsOf/portfolioValue take.
 * derive_24k: every 24K price, converted to this karat. per_karat: only this karat's own prices.
 */
export function goldPricesFor(prices: GoldPrice[], karat: Karat, mode: GoldPriceMode): PriceUpdate[] {
  checkKarat(karat);
  return prices
    .filter((p) => p.karat === (mode === "derive_24k" ? 24 : karat))
    .map((p) => ({ date: p.date, createdAt: p.createdAt, price: mode === "derive_24k" ? karatPrice(p.price, karat) : p.price }));
}

/** Latest price on or before `date` for the karat; a step function, never interpolated. Null when none exists yet. */
export function goldPriceAsOf(prices: GoldPrice[], karat: Karat, date: string, mode: GoldPriceMode): PriceUpdate | null {
  return priceAsOf(goldPricesFor(prices, karat, mode), date);
}

/** grams x buy-back price per gram, whole piasters. */
export function goldValue(grams: string, price: string): Piasters {
  return lineValue(grams, price);
}

/** A gold purchase as the purchase event replayHolding already understands. Workmanship is the fee: it goes into cost basis. */
export function goldPurchaseEvent(
  stamp: { date: string; createdAt: string },
  grams: string,
  metalPrice: string,
  workmanship: Piasters,
): HoldingEvent {
  return { ...stamp, type: "purchase", quantity: grams, price: metalPrice, fee: workmanship };
}
