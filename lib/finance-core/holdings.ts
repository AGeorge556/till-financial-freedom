import type { Piasters } from "./money";

/** Quantity is a 6-decimal string (DB NUMERIC(20,6)); costBasis is whole piasters. */
export type Position = { quantity: string; costBasis: Piasters };

export type SaleResult = {
  costOfSharesSold: Piasters;
  netProceeds: Piasters;
  realizedPL: Piasters;
  remaining: Position;
};

// BigInt() calls, not 1n literals: tsconfig targets below ES2020.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const SCALE = BigInt(1000000);
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

function checkPiasters(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer of piasters: ${value}`);
}

// Round-half-up integer division, non-negative operands.
function divRound(n: bigint, d: bigint): bigint {
  return (TWO * n + d) / (TWO * d);
}

function toPiasters(n: bigint): Piasters {
  const result = Number(n);
  if (!Number.isSafeInteger(result)) throw new RangeError(`Amount out of range: ${n}`);
  return result;
}

/** quantity x price (EGP per unit) -> whole piasters, exact until the single final rounding. */
export function lineValue(quantity: string, price: string): Piasters {
  // qty and price are each scaled 1e6, so the product is scaled 1e12 EGP; x100 for piasters.
  return toPiasters(divRound(toScaled(quantity, "quantity") * toScaled(price, "price") * HUNDRED, SCALE * SCALE));
}

export function applyPurchase(position: Position, quantity: string, price: string, fee: Piasters): Position {
  checkPiasters(fee, "fee");
  const qty = toScaled(quantity, "quantity");
  if (qty === ZERO) throw new RangeError("Purchase quantity must be positive");
  return {
    quantity: fromScaled(toScaled(position.quantity, "position quantity") + qty),
    costBasis: position.costBasis + lineValue(quantity, price) + fee,
  };
}

export function applySale(position: Position, quantity: string, price: string, fee: Piasters): SaleResult {
  checkPiasters(fee, "fee");
  const held = toScaled(position.quantity, "position quantity");
  const sold = toScaled(quantity, "quantity");
  if (sold === ZERO) throw new RangeError("Sale quantity must be positive");
  if (sold > held) throw new RangeError(`Cannot sell ${quantity}; only ${position.quantity} held`);

  // Selling everything takes the whole basis so no rounding residue is left behind.
  const costOfSharesSold =
    sold === held ? position.costBasis : toPiasters(divRound(BigInt(position.costBasis) * sold, held));
  const netProceeds = lineValue(quantity, price) - fee;
  return {
    costOfSharesSold,
    netProceeds,
    realizedPL: netProceeds - costOfSharesSold,
    remaining: { quantity: fromScaled(held - sold), costBasis: position.costBasis - costOfSharesSold },
  };
}

/** Average cost per unit in piasters, rounded; 0 for an empty position. */
export function averageCost(position: Position): Piasters {
  const qty = toScaled(position.quantity, "position quantity");
  if (qty === ZERO) return 0;
  return toPiasters(divRound(BigInt(position.costBasis) * SCALE, qty));
}

export function marketValue(position: Position, currentPrice: string): Piasters {
  return lineValue(position.quantity, currentPrice);
}

export function unrealizedPL(position: Position, currentPrice: string): Piasters {
  return marketValue(position, currentPrice) - position.costBasis;
}
