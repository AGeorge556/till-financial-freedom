import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import type { SavingsTargetMode } from "@/lib/finance-core/allocation";
import { accountBalance, type Tx } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import { DEFAULT_STALE_DAYS, type HoldingEvent, type PriceUpdate } from "@/lib/finance-core/portfolio";
import { eventsByHolding, type LedgerEvent, toHoldingEvents } from "@/lib/backup";
import { db } from "./index";
import {
  accounts,
  allocationOverrides,
  allocationRules,
  categories,
  corporateActions,
  financialAssumptions,
  goalAllocationEvents,
  goalAllocations,
  goals,
  holdings,
  priceUpdates,
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

// ---- Phase 4a: holdings ----

// A database or a transaction handle: the history check inside an action must read through its own transaction.
type Executor = Pick<typeof db, "select">;

export type HoldingRow = typeof holdings.$inferSelect;
export type CorporateActionRow = typeof corporateActions.$inferSelect;
export type HoldingPriceUpdate = PriceUpdate & { id: string; holdingId: string };
export type PortfolioHoldingRow = HoldingRow & { events: HoldingEvent[]; priceUpdates: PriceUpdate[] };
export type PortfolioData = {
  staleDays: number;
  /** Archived holdings included; every row is also a valid `PortfolioHolding` for the engine. */
  holdings: PortfolioHoldingRow[];
  /** Posted buys, sells and dividends that belong to a holding, newest first. */
  trades: TransactionRow[];
  /** Newest first. */
  corporateActions: CorporateActionRow[];
};

export function listHoldings(userId: string, options: { includeArchived?: boolean } = {}): Promise<HoldingRow[]> {
  return db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, userId), options.includeArchived ? undefined : isNull(holdings.archivedAt)))
    .orderBy(asc(holdings.name), asc(holdings.createdAt));
}

export async function getHolding(userId: string, holdingId: string): Promise<HoldingRow | undefined> {
  const [row] = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.id, holdingId)));
  return row;
}

const tradeRows = (userId: string, holdingId: string | undefined, executor: Executor) =>
  executor
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.status, "posted"),
        holdingId ? eq(transactions.holdingId, holdingId) : isNotNull(transactions.holdingId),
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt));

const actionRows = (userId: string, holdingId: string | undefined, executor: Executor) =>
  executor
    .select()
    .from(corporateActions)
    .where(and(eq(corporateActions.userId, userId), holdingId ? eq(corporateActions.holdingId, holdingId) : undefined))
    .orderBy(desc(corporateActions.date), desc(corporateActions.createdAt));

/**
 * Engine events (posted ledger rows and corporate actions) of one holding, or of all of them. Unordered:
 * the engine orders by (date, createdAt). Pass the transaction handle to read inside a transaction.
 */
export async function listHoldingEvents(userId: string, holdingId?: string, executor: Executor = db): Promise<LedgerEvent[]> {
  const trades = await tradeRows(userId, holdingId, executor);
  const actions = await actionRows(userId, holdingId, executor);
  return toHoldingEvents(trades, actions);
}

const toPriceUpdate = (r: typeof priceUpdates.$inferSelect): HoldingPriceUpdate => ({
  id: r.id,
  holdingId: r.holdingId,
  date: r.date,
  price: r.price,
  createdAt: r.createdAt.toISOString(),
});

/** Newest date first. All of the user's, or one holding's. */
export async function listPriceUpdates(userId: string, holdingId?: string): Promise<HoldingPriceUpdate[]> {
  const rows = await db
    .select()
    .from(priceUpdates)
    .where(and(eq(priceUpdates.userId, userId), holdingId ? eq(priceUpdates.holdingId, holdingId) : undefined))
    .orderBy(desc(priceUpdates.date), desc(priceUpdates.createdAt));
  return rows.map(toPriceUpdate);
}

/** Every price update, oldest first: what the backup needs. */
export function listPriceUpdateRows(userId: string) {
  return db
    .select()
    .from(priceUpdates)
    .where(eq(priceUpdates.userId, userId))
    .orderBy(asc(priceUpdates.date), asc(priceUpdates.createdAt));
}

/** Every corporate action, oldest first: what the backup needs. */
export function listCorporateActions(userId: string) {
  return db
    .select()
    .from(corporateActions)
    .where(eq(corporateActions.userId, userId))
    .orderBy(asc(corporateActions.date), asc(corporateActions.createdAt));
}

export async function getStaleDays(userId: string): Promise<number> {
  const [row] = await db
    .select({ days: userSettings.staleDaysHoldings })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row?.days ?? DEFAULT_STALE_DAYS;
}

/** Everything the investment pages need in five queries, however many holdings there are. */
export async function loadPortfolio(userId: string): Promise<PortfolioData> {
  const [holdingRows, trades, actions, prices, staleDays] = await Promise.all([
    listHoldings(userId, { includeArchived: true }),
    tradeRows(userId, undefined, db),
    actionRows(userId, undefined, db),
    listPriceUpdates(userId),
    getStaleDays(userId),
  ]);
  const events = eventsByHolding(toHoldingEvents(trades, actions));
  const pricesBy = new Map<string, PriceUpdate[]>();
  for (const { holdingId, date, price, createdAt } of prices) {
    pricesBy.set(holdingId, [...(pricesBy.get(holdingId) ?? []), { date, price, createdAt }]);
  }
  return {
    staleDays,
    holdings: holdingRows.map((h) => ({ ...h, events: events.get(h.id) ?? [], priceUpdates: pricesBy.get(h.id) ?? [] })),
    trades,
    corporateActions: actions,
  };
}
