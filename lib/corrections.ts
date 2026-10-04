import { type LedgerEvent, toHoldingEvents } from "./backup";
import type { CashFlow, Confirmation, RateChange } from "./finance-core/clouds";
import type { LiabilityUpdate, PrincipalPayment } from "./finance-core/liabilities";

// Pure: no React, Next.js or database imports. A correction never edits a row: it voids the old one and inserts a
// replacement. Before writing either, the action builds the history that would result (every row but the old one, plus
// the replacement) with these, and refuses if the engine's validator rejects it.

type EventTx = Parameters<typeof toHoldingEvents>[0][number];
type EventAction = Parameters<typeof toHoldingEvents>[1][number];
type WithId<T> = T & { id: string };

/**
 * The createdAt a replacement carries. The engines order records by (date, createdAt), so an edit that keeps the date
 * keeps the original position among that day's records (a note fix on a buy must not move it after a sale made the same
 * day). A new date makes it a new entry on that date, which sorts after what is already there.
 */
export function replacementStamp(old: { date: string; createdAt: Date }, date: string, now: Date = new Date()): Date {
  return date === old.date ? old.createdAt : now;
}

/** A holding's events as they would be after dropping one ledger row or corporate action and adding a replacement. */
export function proposedHoldingEvents(
  history: { trades: WithId<EventTx>[]; actions: WithId<EventAction>[] },
  change: { dropTrade?: string; dropAction?: string; addTrade?: EventTx; addAction?: EventAction } = {},
): LedgerEvent[] {
  const trades: EventTx[] = history.trades.filter((t) => t.id !== change.dropTrade);
  const actions: EventAction[] = history.actions.filter((a) => a.id !== change.dropAction);
  if (change.addTrade) trades.push(change.addTrade);
  if (change.addAction) actions.push(change.addAction);
  return toHoldingEvents(trades, actions);
}

/** A Savings Cloud's records as they would be after dropping one flow, rate change or confirmation and adding a replacement. */
export function proposedCloudRecords(
  entries: { flows: WithId<CashFlow>[]; rates: WithId<RateChange>[]; confirmations: WithId<Confirmation>[] },
  change: {
    dropFlow?: string;
    dropRate?: string;
    dropConfirmation?: string;
    addFlow?: CashFlow;
    addRate?: RateChange;
    addConfirmation?: Confirmation;
  } = {},
): { cashFlows: CashFlow[]; rates: RateChange[]; confirmations: Confirmation[] } {
  const cashFlows: CashFlow[] = entries.flows.filter((f) => f.id !== change.dropFlow);
  const rates: RateChange[] = entries.rates.filter((r) => r.id !== change.dropRate);
  const confirmations: Confirmation[] = entries.confirmations.filter((c) => c.id !== change.dropConfirmation);
  if (change.addFlow) cashFlows.push(change.addFlow);
  if (change.addRate) rates.push(change.addRate);
  if (change.addConfirmation) confirmations.push(change.addConfirmation);
  return { cashFlows, rates, confirmations };
}

/** A loan's manual updates and principal payments as they would be after dropping some and adding a replacement. */
export function proposedLiabilityHistory(
  history: { updates: WithId<LiabilityUpdate>[]; payments: WithId<PrincipalPayment>[] },
  change: { dropUpdate?: string; dropPayments?: string[]; addUpdate?: LiabilityUpdate; addPayment?: PrincipalPayment } = {},
): { updates: LiabilityUpdate[]; payments: PrincipalPayment[] } {
  const updates: LiabilityUpdate[] = history.updates.filter((u) => u.id !== change.dropUpdate);
  const payments: PrincipalPayment[] = history.payments.filter((p) => !change.dropPayments?.includes(p.id));
  if (change.addUpdate) updates.push(change.addUpdate);
  if (change.addPayment) payments.push(change.addPayment);
  return { updates, payments };
}

type PaymentRow = { id: string; type: string; status: string; date: string; createdAt: Date; fromAccountId: string | null };

/**
 * The two ledger rows of one loan payment, found from either of them: recordPayment writes the principal and its interest
 * expense together, with the same date, account and createdAt. Null when the row is missing, void, or has no principal.
 */
export function paymentPair<T extends PaymentRow>(rows: T[], rowId: string): { principal: T; interest: T | null } | null {
  const target = rows.find((r) => r.id === rowId);
  if (!target || target.status !== "posted") return null;
  const mates = rows.filter(
    (r) =>
      r.status === "posted" &&
      r.date === target.date &&
      r.fromAccountId === target.fromAccountId &&
      r.createdAt.getTime() === target.createdAt.getTime(),
  );
  const principal = mates.find((r) => r.type === "LIABILITY_PAYMENT");
  return principal ? { principal, interest: mates.find((r) => r.type === "EXPENSE") ?? null } : null;
}
