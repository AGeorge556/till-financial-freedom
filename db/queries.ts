import "server-only";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { accountBalance, type Tx } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import { db } from "./index";
import { accounts, categories, transactions, userSettings } from "./schema";

export type AccountRow = typeof accounts.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;

// Every query takes userId: the Drizzle connection bypasses row-level security.

export function listAccounts(userId: string, options: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), options.includeArchived ? undefined : isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt), asc(accounts.name));
}

export function listCategories(userId: string, options: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), options.includeArchived ? undefined : isNull(categories.archivedAt)))
    .orderBy(asc(categories.kind), asc(categories.name));
}

/** Newest first. Includes void rows (status 'void'); the ledger engine ignores them, a list view should hide them. */
export function listTransactions(userId: string, range?: { from: string; to: string }) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        range ? gte(transactions.date, range.from) : undefined,
        range ? lte(transactions.date, range.to) : undefined,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt));
}

export async function getSettings(userId: string): Promise<{ monthStartDay: number }> {
  const [row] = await db
    .select({ monthStartDay: userSettings.monthStartDay })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return { monthStartDay: row?.monthStartDay ?? 1 };
}

export function toLedgerTx(row: TransactionRow): Tx {
  return {
    type: row.type,
    date: row.date,
    amount: row.amount,
    fromAccountId: row.fromAccountId ?? undefined,
    toAccountId: row.toAccountId ?? undefined,
    status: row.status,
  };
}

// ponytail: balances load every transaction for the user; move to SQL aggregates or a cached balance updated in the same DB transaction if this gets slow.
export function accountBalances(
  accountRows: Pick<AccountRow, "id" | "openingBalance">[],
  allTxRows: TransactionRow[],
): Map<string, Piasters> {
  const txs = allTxRows.map(toLedgerTx);
  return new Map(accountRows.map((a) => [a.id, accountBalance(a.openingBalance, a.id, txs)]));
}
