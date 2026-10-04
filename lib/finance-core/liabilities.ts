import type { Piasters } from "./money";

/**
 * Money the user owes. Outstanding = opening + manual updates - posted principal payments, never negative.
 * A payment's principal reduces the liability and is not spending; its interest is an expense (written by the action).
 */
export type LiabilityUpdate = { date: string; delta: Piasters };
export type PrincipalPayment = { date: string; amount: Piasters };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const upTo = <T extends { date: string }>(xs: T[], asOf?: string) => (asOf === undefined ? xs : xs.filter((x) => x.date <= asOf));

const outstandingRaw = (opening: Piasters, updates: LiabilityUpdate[], payments: PrincipalPayment[], asOf?: string): Piasters =>
  opening + sum(upTo(updates, asOf).map((u) => u.delta)) - sum(upTo(payments, asOf).map((p) => p.amount));

/** Records dated after `asOf` are ignored (all of them if omitted). Callers pass posted payments only. */
export function outstanding(
  opening: Piasters,
  updates: LiabilityUpdate[],
  principalPayments: PrincipalPayment[],
  asOf?: string,
): Piasters {
  return Math.max(0, outstandingRaw(opening, updates, principalPayments, asOf));
}

export type PaymentCheck =
  | { ok: true }
  | { ok: false; error: "invalid-principal" | "invalid-interest" }
  | { ok: false; error: "exceeds-outstanding"; outstanding: Piasters };

/** Principal must be positive and cannot exceed what is outstanding; interest is zero or more and not limited. */
export function validatePayment(principal: Piasters, interest: Piasters, outstandingNow: Piasters): PaymentCheck {
  if (!Number.isSafeInteger(principal) || principal <= 0) return { ok: false, error: "invalid-principal" };
  if (!Number.isSafeInteger(interest) || interest < 0) return { ok: false, error: "invalid-interest" };
  return principal <= outstandingNow ? { ok: true } : { ok: false, error: "exceeds-outstanding", outstanding: outstandingNow };
}

export type LiabilityHistoryCheck = { ok: true } | { ok: false; date: string; message: string };

/**
 * Replays opening + manual updates - principal payments in DATE order and refuses a history where the balance is below
 * zero at the end of any date, so outstanding() on an accepted history never needs its clamp (it stays for legacy data).
 * Actions call this with the existing rows plus the proposed one. The message names a date, never an amount.
 */
export function validateLiabilityHistory(
  opening: Piasters,
  updates: LiabilityUpdate[],
  principalPayments: PrincipalPayment[],
): LiabilityHistoryCheck {
  const dates = [...new Set([...updates.map((u) => u.date), ...principalPayments.map((p) => p.date)])].sort();
  for (const date of dates) {
    if (outstandingRaw(opening, updates, principalPayments, date) < 0) {
      return { ok: false, date, message: `The balance would go below zero on ${date}. Record the borrowing first, or date this payment later.` };
    }
  }
  return { ok: true };
}

export function totalLiabilities(outstandingBalances: Piasters[]): Piasters {
  return sum(outstandingBalances);
}

/**
 * Effect on net worth of the manual updates dated inside the inclusive range, for the reconciliation identity:
 * borrowing more (+delta) lowers net worth, so this is the negated sum. Principal payments are not here: they leave net worth unchanged.
 */
export function liabilityAdjustments(updates: LiabilityUpdate[], range: { start: string; end: string }): Piasters {
  return 0 - sum(updates.filter((u) => u.date >= range.start && u.date <= range.end).map((u) => u.delta));
}
