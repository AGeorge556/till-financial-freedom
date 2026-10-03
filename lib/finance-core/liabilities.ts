import type { Piasters } from "./money";

/**
 * Money the user owes. Outstanding = opening + manual updates - posted principal payments, never negative.
 * A payment's principal reduces the liability and is not spending; its interest is an expense (written by the action).
 */
export type LiabilityUpdate = { date: string; delta: Piasters };
export type PrincipalPayment = { date: string; amount: Piasters };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const upTo = <T extends { date: string }>(xs: T[], asOf?: string) => (asOf === undefined ? xs : xs.filter((x) => x.date <= asOf));

/** Records dated after `asOf` are ignored (all of them if omitted). Callers pass posted payments only. */
export function outstanding(
  opening: Piasters,
  updates: LiabilityUpdate[],
  principalPayments: PrincipalPayment[],
  asOf?: string,
): Piasters {
  const balance =
    opening + sum(upTo(updates, asOf).map((u) => u.delta)) - sum(upTo(principalPayments, asOf).map((p) => p.amount));
  return Math.max(0, balance);
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
