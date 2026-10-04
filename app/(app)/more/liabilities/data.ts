import "server-only";
import {
  type LiabilityUpdateRow,
  type LiabilityView,
  listLiabilities,
  listLiabilityTransactions,
  listLiabilityUpdates,
  outstandingOf,
} from "@/db/queries";
import { totalLiabilities } from "@/lib/finance-core/liabilities";
import type { Piasters } from "@/lib/finance-core/money";

/** Every loan with its history and balance (archived included), and what is owed in total. */
export async function loadLiabilities(userId: string): Promise<{ views: LiabilityView[]; total: Piasters }> {
  const [rows, updates, txs] = await Promise.all([
    listLiabilities(userId, { includeArchived: true }),
    listLiabilityUpdates(userId),
    listLiabilityTransactions(userId),
  ]);
  const views = rows.map((l): LiabilityView => {
    const mine = updates.filter((u) => u.liabilityId === l.id);
    const mineTxs = txs.filter((t) => t.liabilityId === l.id);
    return { ...l, updates: mine, transactions: mineTxs, outstanding: outstandingOf(l, mine, mineTxs) };
  });
  return { views, total: totalLiabilities(views.map((v) => v.outstanding)) };
}

type Base = { key: string; date: string; createdAt: string; note: string | null; removed: boolean };
export type LiabilityEntry = Base &
  (
    | {
        kind: "payment";
        /** The principal row; either row of the payment finds the pair. */
        txId: string;
        principal: Piasters;
        interest: Piasters;
        accountId: string | null;
        /** The interest row's category; null when the payment had no interest. */
        categoryId: string | null;
      }
    | { kind: "update"; id: string; delta: Piasters }
  );

/**
 * Payments (the principal row and its interest row shown as one) and manual updates, newest first. Removed ones come in
 * flagged `removed`: voided payments (kept in the ledger) and the voided updates from loadRemovedRecords.
 */
export function liabilityHistory(view: LiabilityView, removedUpdates: LiabilityUpdateRow[] = []): LiabilityEntry[] {
  const out: LiabilityEntry[] = [];
  type Payment = Extract<LiabilityEntry, { kind: "payment" }>;
  const payments = new Map<string, Payment>();
  for (const t of view.transactions) {
    const createdAt = t.createdAt.toISOString();
    // The two rows of a payment share date, account, stamp and status; a voided pair also shares its voided_at, which tells
    // apart an old version from the one that replaced it (an edit keeps the stamp when the date is unchanged).
    const key = `${createdAt}|${t.date}|${t.fromAccountId}|${t.status}|${t.voidedAt?.toISOString() ?? ""}`;
    const entry: Payment = payments.get(key) ?? {
      key,
      txId: t.id,
      date: t.date,
      createdAt,
      note: t.note,
      removed: t.status === "void",
      kind: "payment",
      principal: 0,
      interest: 0,
      accountId: t.fromAccountId,
      categoryId: null,
    };
    if (t.type === "LIABILITY_PAYMENT") {
      entry.principal = t.amount;
      entry.txId = t.id;
    } else {
      entry.interest = t.amount;
      entry.categoryId = t.categoryId;
    }
    payments.set(key, entry);
  }
  out.push(...payments.values());
  for (const [rows, removed] of [[view.updates, false], [removedUpdates.filter((u) => u.liabilityId === view.id), true]] as const) {
    for (const u of rows) {
      out.push({ key: u.id, id: u.id, date: u.date, createdAt: u.createdAt.toISOString(), note: u.note, removed, kind: "update", delta: u.delta });
    }
  }
  return out.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
  );
}
