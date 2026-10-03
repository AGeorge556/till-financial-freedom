import {
  applyPurchase,
  applySale,
  averageCost,
  lineValue,
  marketValue,
  type Position,
} from "./holdings";
import type { Piasters } from "./money";

/**
 * Unit-based holdings, AVERAGE COST method. Everything here is replayed from dated events;
 * nothing is stored. Events order by (date, createdAt); pending and void rows must not be passed in.
 */
type Stamp = { date: string; createdAt: string };

export type HoldingEvent = Stamp &
  (
    | { type: "purchase"; quantity: string; price: string; fee: Piasters }
    | { type: "sale"; quantity: string; price: string; fee: Piasters; tax: Piasters }
    | { type: "dividend"; gross: Piasters; tax: Piasters }
    | { type: "bonus"; quantity: string }
    | { type: "split"; ratio: string }
    | { type: "writeOff" }
  );

export type HoldingState = Position & {
  /** Piasters per unit, rounded. */
  averageCost: Piasters;
  realizedPL: Piasters;
  dividendsNet: Piasters;
  /** Total cash spent on purchases (quantity x price + fee). */
  invested: Piasters;
  /** Total net cash received from sales. */
  saleProceeds: Piasters;
};

export type PriceUpdate = { date: string; price: string; createdAt: string };

export type HistoryCheck = { ok: true } | { ok: false; error: string; date: string };

/** Default for user_settings.stale_days_holdings. */
export const DEFAULT_STALE_DAYS = 7;

// BigInt() calls, not 1n literals: tsconfig targets below ES2020. Same fixed-point as holdings.ts.
const ZERO = BigInt(0);
const SCALE = BigInt(1000000);
const HALF = BigInt(500000);
const DECIMAL = /^\d+(\.\d{1,6})?$/;

function toScaled(value: string, label: string): bigint {
  if (!DECIMAL.test(value)) throw new RangeError(`${label} must be a non-negative decimal with at most 6 places: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(6, "0"));
}

function fromScaled(n: bigint): string {
  const frac = (n % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${n / SCALE}${frac ? "." + frac : ""}`;
}

function checkMoney(value: Piasters, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer of piasters: ${value}`);
}

function checkPositive(cash: Piasters, label: string): Piasters {
  if (cash <= 0) throw new RangeError(`${label} must be positive, got ${cash}`);
  return cash;
}

function checkQuantity(quantity: string): void {
  if (toScaled(quantity, "quantity") === ZERO) throw new RangeError("Quantity must be positive");
}

/** Cash out for a buy: quantity x price + fee. The fee goes into cost basis, it is not spending. */
export function purchaseCash(quantity: string, price: string, fee: Piasters): Piasters {
  checkMoney(fee, "fee");
  checkQuantity(quantity);
  return checkPositive(lineValue(quantity, price) + fee, "Purchase amount");
}

/** Net cash in for a sale: quantity x price - fee - tax withheld. Gross is `lineValue(quantity, price)`. */
export function saleCash(quantity: string, price: string, fee: Piasters, tax: Piasters): Piasters {
  checkMoney(fee, "fee");
  checkMoney(tax, "tax");
  checkQuantity(quantity);
  return checkPositive(lineValue(quantity, price) - fee - tax, "Sale proceeds");
}

/** Net cash in for a dividend: gross - tax withheld. */
export function dividendCash(gross: Piasters, tax: Piasters): Piasters {
  checkMoney(gross, "gross");
  checkMoney(tax, "tax");
  return checkPositive(gross - tax, "Dividend amount");
}

/**
 * quantity x ratio in exact fixed-point. The product has 12 decimals; it is rounded half up to the
 * 6th decimal (the NUMERIC(20,6) scale), once. Ratio below 1 is a reverse split.
 */
function splitQuantity(quantity: string, ratio: string): string {
  const r = toScaled(ratio, "ratio");
  if (r === ZERO) throw new RangeError("Split ratio must be positive");
  return fromScaled((toScaled(quantity, "quantity") * r + HALF) / SCALE);
}

const EMPTY: HoldingState = {
  quantity: "0",
  costBasis: 0,
  averageCost: 0,
  realizedPL: 0,
  dividendsNet: 0,
  invested: 0,
  saleProceeds: 0,
};

// Throws RangeError when the event is impossible (oversell, zero quantity, zero ratio).
function step(state: HoldingState, e: HoldingEvent): HoldingState {
  switch (e.type) {
    case "purchase": {
      const next = applyPurchase(state, e.quantity, e.price, e.fee);
      return { ...state, ...next, invested: state.invested + purchaseCash(e.quantity, e.price, e.fee) };
    }
    case "sale": {
      const sale = applySale(state, e.quantity, e.price, e.fee);
      const proceeds = saleCash(e.quantity, e.price, e.fee, e.tax); // same rule as the ledger row: net must be positive
      return {
        ...state,
        ...sale.remaining,
        realizedPL: state.realizedPL + proceeds - sale.costOfSharesSold,
        saleProceeds: state.saleProceeds + proceeds,
      };
    }
    case "dividend":
      return { ...state, dividendsNet: state.dividendsNet + dividendCash(e.gross, e.tax) };
    case "bonus": {
      checkQuantity(e.quantity);
      return { ...state, quantity: fromScaled(toScaled(state.quantity, "quantity") + toScaled(e.quantity, "quantity")) };
    }
    case "split": {
      const quantity = splitQuantity(state.quantity, e.ratio);
      if (quantity === "0" && state.costBasis > 0) {
        throw new RangeError("This reverse split would leave no shares but cost basis remains; record a write-off instead");
      }
      return { ...state, quantity };
    }
    case "writeOff":
      return { ...state, quantity: "0", costBasis: 0, realizedPL: state.realizedPL - state.costBasis };
  }
}

const ordered = (events: HoldingEvent[]) =>
  [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

/** Replays the events dated on or before `asOf` (all of them if omitted). Throws RangeError on an impossible history. */
export function replayHolding(events: HoldingEvent[], asOf?: string): HoldingState {
  const state = ordered(events)
    .filter((e) => asOf === undefined || e.date <= asOf)
    .reduce(step, EMPTY);
  return { ...state, averageCost: averageCost(state) };
}

/** Rule F: refuses a history that makes the quantity (or a ratio/quantity input) impossible on any date. */
export function validateHistory(events: HoldingEvent[]): HistoryCheck {
  let state = EMPTY;
  for (const e of ordered(events)) {
    try {
      state = step(state, e);
    } catch (err) {
      if (err instanceof RangeError) return { ok: false, error: err.message, date: e.date };
      throw err;
    }
  }
  return { ok: true };
}

/** Latest price update dated on or before `date` (ties: latest createdAt). A step function, never interpolated. */
export function priceAsOf(priceUpdates: PriceUpdate[], date: string): PriceUpdate | null {
  let best: PriceUpdate | null = null;
  for (const p of priceUpdates) {
    if (p.date > date) continue;
    if (!best || p.date > best.date || (p.date === best.date && p.createdAt > best.createdAt)) best = p;
  }
  return best;
}

export type HoldingValue = {
  value: Piasters;
  /** Date of the price update used; null when valued from a transaction price or not at all. */
  priceDate: string | null;
  source: "price" | "last-transaction" | "none";
};

/** Price update first, else the last transaction price (flagged by `source`), else 0. */
export function holdingValue(
  position: Position,
  priceUpdates: PriceUpdate[],
  lastTransactionPrice: string | null,
  date: string,
): HoldingValue {
  const update = priceAsOf(priceUpdates, date);
  if (update) return { value: marketValue(position, update.price), priceDate: update.date, source: "price" };
  if (lastTransactionPrice !== null) {
    return { value: marketValue(position, lastTransactionPrice), priceDate: null, source: "last-transaction" };
  }
  return { value: 0, priceDate: null, source: "none" };
}

/** Price of the latest purchase or sale on or before `date`, in replay order; null if none. */
export function lastTransactionPrice(events: HoldingEvent[], date: string): string | null {
  let price: string | null = null;
  for (const e of ordered(events)) {
    if (e.date > date) break;
    if (e.type === "purchase" || e.type === "sale") price = e.price;
  }
  return price;
}

const DAY_MS = 86_400_000;
const utcDay = (date: string): number => {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid date: ${date}`);
  return ms;
};

/**
 * Stale when the price is older than `staleDays` days (exactly staleDays old is still fresh).
 * No price update at all (null) is stale with days null.
 */
export function staleness(
  priceDate: string | null,
  today: string,
  staleDays: number,
): { days: number | null; stale: boolean } {
  if (priceDate === null) return { days: null, stale: true };
  const days = Math.max(0, Math.round((utcDay(today) - utcDay(priceDate)) / DAY_MS));
  return { days, stale: days > staleDays };
}

/**
 * A unit-based holding or physical gold (grams are the quantity; gold passes its karat's prices from gold.ts and its
 * own `staleDays`). Value-based clouds have no quantity and never go through here: see `CloudLine`.
 */
export type PortfolioHolding = { id: string; events: HoldingEvent[]; priceUpdates: PriceUpdate[]; staleDays?: number };

export type PortfolioLine = HoldingValue &
  Position & {
    id: string;
    days: number | null;
    stale: boolean;
  };

/** A Savings Cloud already valued by clouds.ts. */
export type CloudLine = { id: string; value: Piasters; stale: boolean };

/**
 * Value of every holding as of `date` (which also serves as "today" for staleness), plus any cloud lines.
 * `stale` is true when any holding still held on that date is valued from a stale or missing price, or a cloud is stale.
 */
export function portfolioValue(
  holdings: PortfolioHolding[],
  date: string,
  staleDays: number = DEFAULT_STALE_DAYS,
  clouds: CloudLine[] = [],
): { total: Piasters; stale: boolean; lines: PortfolioLine[] } {
  const lines = holdings.map((h): PortfolioLine => {
    const { quantity, costBasis } = replayHolding(h.events, date);
    const position = { quantity, costBasis };
    const v = holdingValue(position, h.priceUpdates, lastTransactionPrice(h.events, date), date);
    const held = quantity !== "0";
    const s = staleness(v.priceDate, date, h.staleDays ?? staleDays);
    return { id: h.id, ...position, ...v, days: s.days, stale: held && s.stale };
  });
  const total = lines.reduce((sum, l) => sum + l.value, 0) + clouds.reduce((sum, c) => sum + c.value, 0);
  return { total, stale: lines.some((l) => l.stale) || clouds.some((c) => c.stale), lines };
}
