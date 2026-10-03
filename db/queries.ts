import "server-only";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { SavingsTargetMode } from "@/lib/finance-core/allocation";
import { accountBalance, type Tx } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import { db } from "./index";
import {
  accounts,
  allocationOverrides,
  allocationRules,
  categories,
  financialAssumptions,
  goalAllocationEvents,
  goalAllocations,
  goals,
  transactions,
  userSettings,
} from "./schema";

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

// ---- Phase 3: goals and allocations ----
// numeric(8,6) rates come back from the driver as strings; these queries hand out plain numbers (0.12 = 12%).

const rateOrNull = (v: string | null) => (v === null ? null : Number(v));

export type GoalRow = Omit<typeof goals.$inferSelect, "expectedReturnOverride"> & { expectedReturnOverride: number | null };
export type GoalAllocationRow = typeof goalAllocations.$inferSelect;
export type AllocationEventRow = typeof goalAllocationEvents.$inferSelect;
export type RuleRow = Omit<typeof allocationRules.$inferSelect, "percent"> & { percent: number | null };
export type OverrideRow = typeof allocationOverrides.$inferSelect;

export type PlanSettings = {
  savingsTargetMode: SavingsTargetMode;
  savingsTargetAmount: Piasters | null;
  savingsTargetPercent: number | null;
  expectedMonthlyIncome: Piasters | null;
  expectedMonthlySpending: Piasters | null;
};

export type Assumptions = {
  stockReturn: number | null;
  goldReturn: number | null;
  savingsCloudApy: number | null;
  cashReturn: number | null;
  inflation: number | null;
};

const toGoalRow = (r: typeof goals.$inferSelect): GoalRow => ({
  ...r,
  expectedReturnOverride: rateOrNull(r.expectedReturnOverride),
});

/** By priority (1 first), then oldest first. */
export async function listGoals(userId: string, options: { includeArchived?: boolean } = {}): Promise<GoalRow[]> {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), options.includeArchived ? undefined : isNull(goals.archivedAt)))
    .orderBy(asc(goals.priority), asc(goals.createdAt));
  return rows.map(toGoalRow);
}

export async function getGoal(userId: string, goalId: string): Promise<GoalRow | undefined> {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.id, goalId)));
  return row && toGoalRow(row);
}

/** All of the user's allocations, or one goal's. */
export function listGoalAllocations(userId: string, goalId?: string): Promise<GoalAllocationRow[]> {
  return db
    .select()
    .from(goalAllocations)
    .where(and(eq(goalAllocations.userId, userId), goalId ? eq(goalAllocations.goalId, goalId) : undefined))
    .orderBy(asc(goalAllocations.createdAt));
}

/** Newest first; range is inclusive Cairo dates. */
export function listAllocationEvents(userId: string, range?: { from: string; to: string }): Promise<AllocationEventRow[]> {
  return db
    .select()
    .from(goalAllocationEvents)
    .where(
      and(
        eq(goalAllocationEvents.userId, userId),
        range ? gte(goalAllocationEvents.date, range.from) : undefined,
        range ? lte(goalAllocationEvents.date, range.to) : undefined,
      ),
    )
    .orderBy(desc(goalAllocationEvents.date), desc(goalAllocationEvents.createdAt));
}

/** Creation order, which the engine uses to order bucket rules. */
export async function listRules(userId: string): Promise<RuleRow[]> {
  const rows = await db
    .select()
    .from(allocationRules)
    .where(eq(allocationRules.userId, userId))
    .orderBy(asc(allocationRules.createdAt), asc(allocationRules.id));
  return rows.map((r) => ({ ...r, percent: rateOrNull(r.percent) }));
}

/** Overrides of one financial month ('YYYY-MM' of its start), or all of them when month is omitted. */
export function listOverrides(userId: string, month?: string): Promise<OverrideRow[]> {
  return db
    .select()
    .from(allocationOverrides)
    .where(and(eq(allocationOverrides.userId, userId), month ? eq(allocationOverrides.month, month) : undefined))
    .orderBy(asc(allocationOverrides.month), asc(allocationOverrides.createdAt));
}

export async function getPlanSettings(userId: string): Promise<PlanSettings> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return {
    savingsTargetMode: row?.savingsTargetMode ?? "flexible",
    savingsTargetAmount: row?.savingsTargetAmount ?? null,
    savingsTargetPercent: rateOrNull(row?.savingsTargetPercent ?? null),
    expectedMonthlyIncome: row?.expectedMonthlyIncome ?? null,
    expectedMonthlySpending: row?.expectedMonthlySpending ?? null,
  };
}

/** Every rate is null until the user sets it; nothing is defaulted here. */
export async function getAssumptions(userId: string): Promise<Assumptions> {
  const [row] = await db.select().from(financialAssumptions).where(eq(financialAssumptions.userId, userId));
  return {
    stockReturn: rateOrNull(row?.stockReturn ?? null),
    goldReturn: rateOrNull(row?.goldReturn ?? null),
    savingsCloudApy: rateOrNull(row?.savingsCloudApy ?? null),
    cashReturn: rateOrNull(row?.cashReturn ?? null),
    inflation: rateOrNull(row?.inflation ?? null),
  };
}
