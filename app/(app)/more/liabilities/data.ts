import "server-only";
import {
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

type Base = { key: string; date: string; createdAt: string; note: string | null };
export type LiabilityEntry = Base &
  (
    | { kind: "payment"; txId: string; principal: Piasters; interest: Piasters; voided: boolean }
    | { kind: "update"; delta: Piasters }
  );

/** Payments (the principal row and its interest row shown as one) and manual updates, newest first. Voided payments are kept, marked. */
export function liabilityHistory(view: LiabilityView): LiabilityEntry[] {
  const out: LiabilityEntry[] = [];
  // voidPayment finds a payment's two rows by this same key, so they are one entry here too.
  type Payment = Extract<LiabilityEntry, { kind: "payment" }>;
  const payments = new Map<string, Payment>();
  for (const t of view.transactions) {
    const createdAt = t.createdAt.toISOString();
    const key = `${createdAt}|${t.date}|${t.fromAccountId}`;
    const entry: Payment = payments.get(key) ?? {
      key,
      txId: t.id,
      date: t.date,
      createdAt,
      note: t.note,
      kind: "payment",
      principal: 0,
      interest: 0,
      voided: true,
    };
    entry.voided = entry.voided && t.status === "void";
    if (t.type === "LIABILITY_PAYMENT") {
      entry.principal = t.amount;
      entry.txId = t.id;
    } else {
      entry.interest = t.amount;
    }
    payments.set(key, entry);
  }
  out.push(...payments.values());
  for (const u of view.updates) {
    out.push({ key: u.id, date: u.date, createdAt: u.createdAt.toISOString(), note: u.note, kind: "update", delta: u.delta });
  }
  return out.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
  );
}
