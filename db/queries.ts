import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, min } from "drizzle-orm";
import type { GoalData } from "@/app/(app)/goals/data";
import type { BudgetLine } from "@/app/(app)/spending/data";
import type { SavingsTargetMode } from "@/lib/finance-core/allocation";
import {
  DEFAULT_NOTABLE_AMOUNT,
  DEFAULT_NOTABLE_PERCENT,
  fullMonths,
  monthTotals,
  trailingAverage,
} from "@/lib/finance-core/analytics";
import { DEFAULT_BUDGET_ALERT_AT, DEFAULT_BUDGET_WARN_AT } from "@/lib/finance-core/budget";
import { type HistoryData, type HistoryPoint, MAX_POINTS, seriesFromSnapshots, snapshotsAsOf } from "@/lib/finance-core/history";
import type { InsightInput } from "@/lib/finance-core/insights";
import { accountBalance, filterByDateRange, netWorth, periodSummary, type Tx } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import {
  apyAsOf,
  type CashFlow,
  cloudLine,
  type Confirmation,
  DEFAULT_STALE_DAYS_CLOUDS,
  type RateChange,
} from "@/lib/finance-core/clouds";
import { DEFAULT_STALE_DAYS_GOLD, type GoldPrice, type GoldPriceMode, goldPricesFor, type Karat } from "@/lib/finance-core/gold";
import { holdingFreeShare } from "@/lib/finance-core/goals";
import { outstanding } from "@/lib/finance-core/liabilities";
import { DEFAULT_STALE_DAYS, type HoldingEvent, type PriceUpdate, portfolioValue } from "@/lib/finance-core/portfolio";
import { mix, MIX_CLASSES, type MixClass, type Targets } from "@/lib/finance-core/portfolioMix";
import { addDays, missingOccurrences, type RecurringRow, type RecurringTemplate } from "@/lib/finance-core/recurring";
import type { ReminderInput, ReminderSwitches } from "@/lib/finance-core/reminders";
import type { ScenarioInput } from "@/lib/finance-core/scenario";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";
import { eventsByHolding, type LedgerEvent, toHoldingEvents } from "@/lib/backup";
import { db } from "./index";
import {
  accounts,
  allocationOverrides,
  allocationRules,
  budgets,
  categories,
  cloudConfirmations,
  corporateActions,
  financialAssumptions,
  goalAllocationEvents,
  goalAllocations,
  goals,
  goldPrices,
  holdings,
  liabilities,
  liabilityUpdates,
  priceUpdates,
  rateHistory,
  recurringTemplates,
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

export async function getSettings(
  userId: string,
): Promise<{ monthStartDay: number; goldPriceMode: GoldPriceMode; staleDaysGold: number; staleDaysClouds: number }> {
  const [row] = await db
    .select({
      monthStartDay: userSettings.monthStartDay,
      goldPriceMode: userSettings.goldPriceMode,
      staleDaysGold: userSettings.staleDaysGold,
      staleDaysClouds: userSettings.staleDaysClouds,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return {
    monthStartDay: row?.monthStartDay ?? 1,
    goldPriceMode: row?.goldPriceMode ?? "derive_24k",
    staleDaysGold: row?.staleDaysGold ?? DEFAULT_STALE_DAYS_GOLD,
    staleDaysClouds: row?.staleDaysClouds ?? DEFAULT_STALE_DAYS_CLOUDS,
  };
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
  /** Yearly growth of income for the scenario calculator. */
  incomeGrowth: number | null;
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
    incomeGrowth: rateOrNull(row?.incomeGrowth ?? null),
  };
}

// ---- Phase 4a: holdings ----

// A database or a transaction handle: the history check inside an action must read through its own transaction.
type Executor = Pick<typeof db, "select">;

export type HoldingRow = typeof holdings.$inferSelect;
export type CorporateActionRow = typeof corporateActions.$inferSelect;
export type HoldingPriceUpdate = PriceUpdate & { id: string; holdingId: string };
/** What clouds.ts needs to value one Savings Cloud. */
export type CloudRecords = { confirmations: Confirmation[]; cashFlows: CashFlow[]; rates: RateChange[] };
/**
 * A gold row carries its karat's buy-back prices (derived per the user's mode) as `priceUpdates` and its own `staleDays`,
 * a cloud row carries `cloud` and no events. Archived rows included.
 */
export type PortfolioHoldingRow = HoldingRow & {
  events: HoldingEvent[];
  priceUpdates: PriceUpdate[];
  staleDays?: number;
  cloud: CloudRecords | null;
};
export type WealthSettings = {
  staleDaysHoldings: number;
  goldPriceMode: GoldPriceMode;
  staleDaysGold: number;
  staleDaysClouds: number;
};
export type GoldPriceEntry = GoldPrice & { id: string };
export type RateHistoryEntry = RateChange & { id: string; holdingId: string };
export type CloudConfirmationEntry = Confirmation & { id: string; holdingId: string };
export type PortfolioData = {
  staleDays: number;
  settings: WealthSettings;
  /** Archived holdings included; every row is also a valid `PortfolioHolding` for the engine (clouds: see `valuePortfolio`). */
  holdings: PortfolioHoldingRow[];
  /** Posted ledger rows that belong to a holding, newest first. Cloud deposits and withdrawals have no quantity or unit price. */
  trades: TransactionRow[];
  /** Newest first. */
  corporateActions: CorporateActionRow[];
  /** Global buy-back prices per gram, newest first. */
  goldPrices: GoldPriceEntry[];
  /** Newest effective date first. */
  rateHistory: RateHistoryEntry[];
  /** Newest first. */
  confirmations: CloudConfirmationEntry[];
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
export async function listPriceUpdates(userId: string, holdingId?: string, executor: Executor = db): Promise<HoldingPriceUpdate[]> {
  const rows = await executor
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

export async function getWealthSettings(userId: string, executor: Executor = db): Promise<WealthSettings> {
  const [row] = await executor.select().from(userSettings).where(eq(userSettings.userId, userId));
  return {
    staleDaysHoldings: row?.staleDaysHoldings ?? DEFAULT_STALE_DAYS,
    goldPriceMode: row?.goldPriceMode ?? "derive_24k",
    staleDaysGold: row?.staleDaysGold ?? DEFAULT_STALE_DAYS_GOLD,
    staleDaysClouds: row?.staleDaysClouds ?? DEFAULT_STALE_DAYS_CLOUDS,
  };
}

// ---- Phase 4b: gold, Savings Clouds, liabilities, holding shares ----

const toGoldPrice = (r: typeof goldPrices.$inferSelect): GoldPriceEntry => ({
  id: r.id,
  date: r.date,
  karat: r.karat as Karat, // gold_prices_karat_check
  price: r.buybackPrice,
  createdAt: r.createdAt.toISOString(),
});

const toRateChange = (r: typeof rateHistory.$inferSelect): RateHistoryEntry => ({
  id: r.id,
  holdingId: r.holdingId,
  date: r.effectiveDate,
  apy: Number(r.apy),
  createdAt: r.createdAt.toISOString(),
});

const toConfirmation = (r: typeof cloudConfirmations.$inferSelect): CloudConfirmationEntry => ({
  id: r.id,
  holdingId: r.holdingId,
  date: r.date,
  value: r.value,
  createdAt: r.createdAt.toISOString(),
});

/** A deposit or withdrawal: a purchase or sale row of a holding with no quantity (the shape only clouds use). */
const isCloudFlow = (t: TransactionRow) =>
  t.holdingId !== null && t.quantity === null && (t.type === "INVESTMENT_PURCHASE" || t.type === "INVESTMENT_SALE");

const toCashFlow = (t: TransactionRow): CashFlow => ({
  date: t.date,
  createdAt: t.createdAt.toISOString(),
  kind: t.type === "INVESTMENT_PURCHASE" ? "deposit" : "withdrawal",
  amount: t.amount,
});

/** Global buy-back prices per gram, newest first. Pass the transaction handle to read inside a transaction. */
export async function listGoldPrices(userId: string, executor: Executor = db): Promise<GoldPriceEntry[]> {
  const rows = await executor
    .select()
    .from(goldPrices)
    .where(eq(goldPrices.userId, userId))
    .orderBy(desc(goldPrices.date), desc(goldPrices.createdAt));
  return rows.map(toGoldPrice);
}

/** Rate changes, confirmations and cash flows of one cloud, as the engine wants them (posted flows only). */
export async function listCloudRecords(userId: string, holdingId: string, executor: Executor = db): Promise<CloudRecords> {
  const rates = await executor
    .select()
    .from(rateHistory)
    .where(and(eq(rateHistory.userId, userId), eq(rateHistory.holdingId, holdingId)));
  const confirmations = await executor
    .select()
    .from(cloudConfirmations)
    .where(and(eq(cloudConfirmations.userId, userId), eq(cloudConfirmations.holdingId, holdingId)));
  const trades = await tradeRows(userId, holdingId, executor);
  return {
    rates: rates.map(toRateChange),
    confirmations: confirmations.map(toConfirmation),
    cashFlows: trades.filter(isCloudFlow).map(toCashFlow),
  };
}

export type LiabilityRow = Omit<typeof liabilities.$inferSelect, "interestRate"> & { interestRate: number | null };
export type LiabilityUpdateRow = typeof liabilityUpdates.$inferSelect;
export type LiabilityView = LiabilityRow & {
  /** Oldest first. */
  updates: LiabilityUpdateRow[];
  /** Principal and interest rows of this liability, void ones included, newest first. */
  transactions: TransactionRow[];
  outstanding: Piasters;
};

const toLiabilityRow = (r: typeof liabilities.$inferSelect): LiabilityRow => ({ ...r, interestRate: rateOrNull(r.interestRate) });

export async function listLiabilities(userId: string, options: { includeArchived?: boolean } = {}): Promise<LiabilityRow[]> {
  const rows = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.userId, userId), options.includeArchived ? undefined : isNull(liabilities.archivedAt)))
    .orderBy(asc(liabilities.createdAt), asc(liabilities.name));
  return rows.map(toLiabilityRow);
}

/** Oldest first. All of the user's, or one liability's. */
export function listLiabilityUpdates(userId: string, liabilityId?: string, executor: Executor = db): Promise<LiabilityUpdateRow[]> {
  return executor
    .select()
    .from(liabilityUpdates)
    .where(and(eq(liabilityUpdates.userId, userId), liabilityId ? eq(liabilityUpdates.liabilityId, liabilityId) : undefined))
    .orderBy(asc(liabilityUpdates.date), asc(liabilityUpdates.createdAt));
}

/** Every ledger row that carries a liability_id (principal payments and interest expenses), void ones included, newest first. */
export function listLiabilityTransactions(userId: string, liabilityId?: string, executor: Executor = db): Promise<TransactionRow[]> {
  return executor
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        liabilityId ? eq(transactions.liabilityId, liabilityId) : isNotNull(transactions.liabilityId),
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt));
}

/** Outstanding balance from a liability's own rows; only posted principal payments count. */
export function outstandingOf(
  liability: Pick<LiabilityRow, "openingBalance">,
  updates: Pick<LiabilityUpdateRow, "date" | "delta">[],
  liabilityTransactions: Pick<TransactionRow, "type" | "status" | "date" | "amount">[],
  asOf?: string,
): Piasters {
  const principal = liabilityTransactions.filter((t) => t.type === "LIABILITY_PAYMENT" && t.status === "posted");
  return outstanding(
    liability.openingBalance,
    updates.map((u) => ({ date: u.date, delta: u.delta })),
    principal.map((t) => ({ date: t.date, amount: t.amount })),
    asOf,
  );
}

/** Goal allocations that target a holding (a percentage share), all of the user's or one holding's. */
export function listHoldingAllocations(userId: string, holdingId?: string, executor: Executor = db): Promise<GoalAllocationRow[]> {
  return executor
    .select()
    .from(goalAllocations)
    .where(
      and(
        eq(goalAllocations.userId, userId),
        holdingId ? eq(goalAllocations.holdingId, holdingId) : isNotNull(goalAllocations.holdingId),
      ),
    )
    .orderBy(asc(goalAllocations.createdAt));
}

/**
 * The tables the older list functions do not read, for the backup: children first, then the liabilities they point at.
 * Call it before reading holdings, so every rate change and confirmation finds its holding in the file.
 */
export async function listWealthRows(userId: string) {
  const byTime = <T extends { createdAt: Date }>(a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime();
  const liabilityUpdateRows = (await listLiabilityUpdates(userId)).sort(byTime);
  const rateRows = (await db.select().from(rateHistory).where(eq(rateHistory.userId, userId))).sort(byTime);
  const confirmationRows = (await db.select().from(cloudConfirmations).where(eq(cloudConfirmations.userId, userId))).sort(byTime);
  const goldPriceRows = (await db.select().from(goldPrices).where(eq(goldPrices.userId, userId))).sort(byTime);
  const liabilityRows = await db.select().from(liabilities).where(eq(liabilities.userId, userId)).orderBy(asc(liabilities.createdAt));
  return {
    goldPrices: goldPriceRows,
    rateHistory: rateRows,
    cloudConfirmations: confirmationRows,
    liabilities: liabilityRows,
    liabilityUpdates: liabilityUpdateRows,
  };
}

/** Everything the investment pages need in eight queries, however many holdings there are. */
export async function loadPortfolio(userId: string): Promise<PortfolioData> {
  const [holdingRows, trades, actions, prices, settings, goldRows, rateRows, confirmationRows] = await Promise.all([
    listHoldings(userId, { includeArchived: true }),
    tradeRows(userId, undefined, db),
    actionRows(userId, undefined, db),
    listPriceUpdates(userId),
    getWealthSettings(userId),
    listGoldPrices(userId),
    db
      .select()
      .from(rateHistory)
      .where(eq(rateHistory.userId, userId))
      .orderBy(desc(rateHistory.effectiveDate), desc(rateHistory.createdAt)),
    db
      .select()
      .from(cloudConfirmations)
      .where(eq(cloudConfirmations.userId, userId))
      .orderBy(desc(cloudConfirmations.date), desc(cloudConfirmations.createdAt)),
  ]);
  const events = eventsByHolding(toHoldingEvents(trades, actions));
  const pricesBy = new Map<string, PriceUpdate[]>();
  for (const { holdingId, date, price, createdAt } of prices) {
    pricesBy.set(holdingId, [...(pricesBy.get(holdingId) ?? []), { date, price, createdAt }]);
  }
  const rates = rateRows.map(toRateChange);
  const confirmations = confirmationRows.map(toConfirmation);
  const flowsBy = new Map<string, CashFlow[]>();
  for (const t of trades.filter(isCloudFlow)) flowsBy.set(t.holdingId!, [...(flowsBy.get(t.holdingId!) ?? []), toCashFlow(t)]);

  const holdingsOut = holdingRows.map((h): PortfolioHoldingRow => {
    if (h.kind === "cloud") {
      return {
        ...h,
        events: [],
        priceUpdates: [],
        cloud: {
          rates: rates.filter((r) => r.holdingId === h.id),
          confirmations: confirmations.filter((c) => c.holdingId === h.id),
          cashFlows: flowsBy.get(h.id) ?? [],
        },
      };
    }
    if (h.kind === "gold") {
      return {
        ...h,
        events: events.get(h.id) ?? [],
        priceUpdates: goldPricesFor(goldRows, h.karat as Karat, settings.goldPriceMode),
        staleDays: settings.staleDaysGold,
        cloud: null,
      };
    }
    return { ...h, events: events.get(h.id) ?? [], priceUpdates: pricesBy.get(h.id) ?? [], cloud: null };
  });
  return {
    staleDays: settings.staleDaysHoldings,
    settings,
    holdings: holdingsOut,
    trades,
    corporateActions: actions,
    goldPrices: goldRows,
    rateHistory: rates,
    confirmations,
  };
}

export type CloudValue = ReturnType<typeof cloudLine> & { apy: number | null };
export type PortfolioValuation = {
  total: Piasters;
  stale: boolean;
  /** Stocks, funds, other and gold. */
  lines: ReturnType<typeof portfolioValue>["lines"];
  clouds: CloudValue[];
};

/** The whole portfolio as of `today`: unit-based and gold lines plus every cloud's estimate, composed by the engine. */
export function valuePortfolio(portfolio: PortfolioData, today: string): PortfolioValuation {
  const clouds = portfolio.holdings
    .filter((h) => h.cloud)
    .map((h): CloudValue => ({
      ...cloudLine({ id: h.id, ...h.cloud!, today, staleDays: portfolio.settings.staleDaysClouds }),
      apy: apyAsOf(h.cloud!.rates, today),
    }));
  const v = portfolioValue(
    portfolio.holdings.filter((h) => !h.cloud),
    today,
    portfolio.staleDays,
    clouds,
  );
  return { total: v.total, stale: v.stale, lines: v.lines, clouds };
}

/** Current value of one holding, read through `executor` (pass the transaction handle inside an action). */
export async function holdingValueNow(
  userId: string,
  holding: Pick<HoldingRow, "id" | "kind" | "karat">,
  today: string,
  executor: Executor = db,
): Promise<Piasters> {
  const settings = await getWealthSettings(userId, executor);
  if (holding.kind === "cloud") {
    const records = await listCloudRecords(userId, holding.id, executor);
    return cloudLine({ id: holding.id, ...records, today, staleDays: settings.staleDaysClouds }).value;
  }
  const events = await listHoldingEvents(userId, holding.id, executor);
  const priceUpdates =
    holding.kind === "gold"
      ? goldPricesFor(await listGoldPrices(userId, executor), holding.karat as Karat, settings.goldPriceMode)
      : (await listPriceUpdates(userId, holding.id, executor)).map(({ date, price, createdAt }) => ({ date, price, createdAt }));
  return portfolioValue([{ id: holding.id, events, priceUpdates }], today, settings.staleDaysHoldings).total;
}

export type WealthData = {
  today: string;
  portfolio: PortfolioData;
  valuation: PortfolioValuation;
  /** Current value of every holding (stock, fund, other, gold, cloud) by id, in piasters. */
  holdingValues: Map<string, Piasters>;
  /** Archived ones included; their balance is 0. */
  liabilities: LiabilityView[];
  liabilitiesTotal: Piasters;
  /** Every goal's percentage share of a holding. */
  holdingShares: GoalAllocationRow[];
  /** The part of each holding (by id, a decimal fraction) no goal has claimed. */
  freeShares: Map<string, string>;
};

/**
 * Everything Home and the goal loader need about holdings, clouds, gold and liabilities, in twelve queries
 * however many rows there are. Net worth = cash + `valuation.total` - `liabilitiesTotal`.
 */
export async function loadWealth(userId: string, today: string = cairoToday()): Promise<WealthData> {
  const [portfolio, liabilityRows, updates, liabilityTxs, holdingShares] = await Promise.all([
    loadPortfolio(userId),
    listLiabilities(userId, { includeArchived: true }),
    listLiabilityUpdates(userId),
    listLiabilityTransactions(userId),
    listHoldingAllocations(userId),
  ]);
  const valuation = valuePortfolio(portfolio, today);
  const holdingValues = new Map<string, Piasters>([
    ...valuation.lines.map((l): [string, Piasters] => [l.id, l.value]),
    ...valuation.clouds.map((c): [string, Piasters] => [c.id, c.value]),
  ]);
  const views = liabilityRows.map((l): LiabilityView => {
    const mine = updates.filter((u) => u.liabilityId === l.id);
    const txs = liabilityTxs.filter((t) => t.liabilityId === l.id);
    return { ...l, updates: mine, transactions: txs, outstanding: outstandingOf(l, mine, txs) };
  });
  const freeShares = new Map(
    portfolio.holdings.map((h): [string, string] => [
      h.id,
      holdingFreeShare(holdingShares.filter((s) => s.holdingId === h.id).map((s) => s.percent!)),
    ]),
  );
  return {
    today,
    portfolio,
    valuation,
    holdingValues,
    liabilities: views,
    liabilitiesTotal: views.reduce((sum, l) => sum + l.outstanding, 0),
    holdingShares,
    freeShares,
  };
}

// ---- Phase 5a: budgets, recurring items, month and net worth loaders, backup rows ----

export type BudgetRow = typeof budgets.$inferSelect;
export type RecurringTemplateRow = typeof recurringTemplates.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** In creation order. The overall budget is the one with no categoryId. */
export function listBudgets(userId: string, executor: Executor = db): Promise<BudgetRow[]> {
  return executor
    .select()
    .from(budgets)
    .where(eq(budgets.userId, userId))
    .orderBy(asc(budgets.createdAt), asc(budgets.id));
}

/** Active and inactive ones by name, or only the active ones. */
export function listRecurringTemplates(
  userId: string,
  options: { activeOnly?: boolean } = {},
  executor: Executor = db,
): Promise<RecurringTemplateRow[]> {
  return executor
    .select()
    .from(recurringTemplates)
    .where(and(eq(recurringTemplates.userId, userId), options.activeOnly ? eq(recurringTemplates.active, true) : undefined))
    .orderBy(asc(recurringTemplates.name), asc(recurringTemplates.createdAt));
}

/** Generated rows waiting for a confirm or skip, oldest first. Their note is the template's name. */
export function listPendingRecurring(userId: string): Promise<TransactionRow[]> {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.status, "pending"), isNotNull(transactions.recurringTemplateId)))
    .orderBy(asc(transactions.date), asc(transactions.createdAt));
}

/** Budget warning thresholds as decimals (0.8 = 80% of a budget spent), defaults until the user sets them. */
export async function getBudgetThresholds(userId: string): Promise<{ warnAt: number; alertAt: number }> {
  const [row] = await db
    .select({ warnAt: userSettings.budgetWarnAt, alertAt: userSettings.budgetAlertAt })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return {
    warnAt: row ? Number(row.warnAt) : DEFAULT_BUDGET_WARN_AT,
    alertAt: row ? Number(row.alertAt) : DEFAULT_BUDGET_ALERT_AT,
  };
}

const toTemplate = (t: RecurringTemplateRow): RecurringTemplate => ({
  id: t.id,
  type: t.type as RecurringTemplate["type"], // recurring_templates_type_check
  amount: t.amount,
  categoryId: t.categoryId,
  accountId: t.accountId,
  frequency: t.frequency,
  startDate: t.startDate,
  endDate: t.endDate,
  active: t.active,
});

/** A ledger row as the budget and analytics engines want it: `fixed` = it came from a recurring template. */
export const toAnalyticsTx = (row: TransactionRow): Tx & { categoryId: string | null; fixed: boolean } => ({
  ...toLedgerTx(row),
  categoryId: row.categoryId,
  fixed: row.recurringTemplateId !== null,
});

const GENERATE_CHUNK = 500;

/**
 * Lazy, idempotent generation (R3): inserts every due date up to today that has no row yet, for every active template
 * (or one), pending unless the template auto-posts. Safe on every page load and from concurrent requests: the unique
 * index on (template, due date) plus ON CONFLICT DO NOTHING means a date is created exactly once, whatever its status
 * (a skipped row stays skipped). Returns how many rows it created. Lives here, not in app/actions, because every export
 * of a "use server" file is a public endpoint and this one takes a user id. `forcePending` is for a template that was
 * just reactivated: the gap while it was off never posts money by itself.
 */
export async function generateDueRecurring(
  userId: string,
  options: { today?: string; templateId?: string; forcePending?: boolean; tx?: DbTransaction } = {},
): Promise<number> {
  const today = options.today ?? cairoToday();
  const run = async (tx: DbTransaction): Promise<number> => {
    const templates = await tx
      .select()
      .from(recurringTemplates)
      .where(
        and(
          eq(recurringTemplates.userId, userId),
          eq(recurringTemplates.active, true),
          options.templateId ? eq(recurringTemplates.id, options.templateId) : undefined,
        ),
      );
    if (templates.length === 0) return 0;
    const existing = await tx
      .select({ templateId: transactions.recurringTemplateId, dueDate: transactions.recurringDueDate })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNotNull(transactions.recurringTemplateId)));
    const have = new Map<string, string[]>();
    for (const r of existing) have.set(r.templateId!, [...(have.get(r.templateId!) ?? []), r.dueDate!]);

    const rows = templates.flatMap((t) =>
      missingOccurrences(t, have.get(t.id) ?? [], today).map((dueDate) => ({
        userId,
        type: t.type,
        date: dueDate,
        amount: t.amount,
        fromAccountId: t.type === "EXPENSE" ? t.accountId : null,
        toAccountId: t.type === "INCOME" ? t.accountId : null,
        categoryId: t.categoryId,
        note: t.name,
        status: t.autoPost && !options.forcePending ? ("posted" as const) : ("pending" as const),
        recurringTemplateId: t.id,
        recurringDueDate: dueDate,
      })),
    );
    let created = 0;
    for (let i = 0; i < rows.length; i += GENERATE_CHUNK) {
      const inserted = await tx
        .insert(transactions)
        .values(rows.slice(i, i + GENERATE_CHUNK))
        .onConflictDoNothing({ target: [transactions.recurringTemplateId, transactions.recurringDueDate] })
        .returning({ id: transactions.id });
      created += inserted.length;
    }
    return created;
  };
  return options.tx ? run(options.tx) : db.transaction(run);
}

export type MonthData = {
  range: { start: string; end: string };
  /** Every ledger row dated in the month, any status: the engines count posted rows only. */
  txs: TransactionRow[];
  /** Manual loan updates dated in the month. */
  liabilityUpdates: LiabilityUpdateRow[];
  /** Goal allocation events dated in the month, newest first. */
  allocationEvents: AllocationEventRow[];
  /** Active templates, and the rows already generated for due dates in the month (any status): input of upcomingInMonth. */
  templates: RecurringTemplate[];
  occurrences: RecurringRow[];
};

/** One financial month for the review and the budgets, in five queries. */
export async function loadMonth(userId: string, range: { start: string; end: string }): Promise<MonthData> {
  const [txs, updates, allocationEvents, templates, occurrences] = await Promise.all([
    listTransactions(userId, { from: range.start, to: range.end }),
    db
      .select()
      .from(liabilityUpdates)
      .where(and(eq(liabilityUpdates.userId, userId), gte(liabilityUpdates.date, range.start), lte(liabilityUpdates.date, range.end)))
      .orderBy(asc(liabilityUpdates.date), asc(liabilityUpdates.createdAt)),
    listAllocationEvents(userId, { from: range.start, to: range.end }),
    listRecurringTemplates(userId, { activeOnly: true }),
    db
      .select({
        templateId: transactions.recurringTemplateId,
        dueDate: transactions.recurringDueDate,
        status: transactions.status,
        type: transactions.type,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
        fromAccountId: transactions.fromAccountId,
        toAccountId: transactions.toAccountId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNotNull(transactions.recurringTemplateId),
          gte(transactions.recurringDueDate, range.start),
          lte(transactions.recurringDueDate, range.end),
        ),
      ),
  ]);
  return {
    range,
    txs,
    liabilityUpdates: updates,
    allocationEvents,
    templates: templates.map(toTemplate),
    // A pending row carries its own figures: the person may have edited it, and its template may be paused or gone.
    occurrences: occurrences.map((o): RecurringRow =>
      o.status === "pending"
        ? {
            templateId: o.templateId!,
            dueDate: o.dueDate!,
            status: "pending",
            type: o.type as "INCOME" | "EXPENSE", // pending rows come from templates: recurring_templates_type_check
            amount: o.amount,
            categoryId: o.categoryId,
            accountId: (o.type === "INCOME" ? o.toAccountId : o.fromAccountId)!,
          }
        : { templateId: o.templateId!, dueDate: o.dueDate!, status: o.status },
    ),
  };
}

/** Date of the first posted ledger row, or null with no history yet: the start of the data for fullMonths. */
export async function firstTransactionDate(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ first: min(transactions.date) })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.status, "posted")));
  return row?.first ?? null;
}

/**
 * Essential spending (expense categories flagged is_essential) of each of the last `months` FULL financial months before
 * the current one, oldest first; empty with less than one full month of history. Input of emergencyTarget.
 */
export async function essentialMonthlyTotals(userId: string, today: string, monthStartDay: number, months = 6): Promise<Piasters[]> {
  const ranges = fullMonths(await firstTransactionDate(userId), today, monthStartDay, months);
  if (ranges.length === 0) return [];
  const rows = await db
    .select({ type: transactions.type, date: transactions.date, amount: transactions.amount, status: transactions.status })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(categories.userId, userId),
        eq(categories.isEssential, true),
        eq(transactions.type, "EXPENSE"),
        gte(transactions.date, ranges[0].start),
        lte(transactions.date, ranges[ranges.length - 1].end),
      ),
    );
  return monthTotals(rows, ranges).map((m) => m.spending);
}

export type NetWorthSnapshot = { date: string; cash: Piasters; holdings: Piasters; liabilities: Piasters; netWorth: Piasters };

/** Everything a replay of the past needs, read once however many dates are evaluated. */
async function readLedgerWorld(userId: string) {
  const [accountRows, txRows, portfolio, liabilityRows, updates, liabilityTxs] = await Promise.all([
    listAccounts(userId, { includeArchived: true }),
    listTransactions(userId),
    loadPortfolio(userId),
    listLiabilities(userId, { includeArchived: true }),
    listLiabilityUpdates(userId),
    listLiabilityTransactions(userId),
  ]);
  return { accountRows, txRows, portfolio, liabilityRows, updates, liabilityTxs };
}

/**
 * Net worth as of each date (cash + holdings, gold and clouds - liabilities), from one load of the user's records.
 * Records dated after a date are ignored: ledger rows, prices, confirmations, rate changes, loan updates and payments.
 * An account's opening balance and a loan's opening balance count from the start (neither has an effective date).
 */
export async function loadNetWorthSnapshots(userId: string, dates: string[]): Promise<NetWorthSnapshot[]> {
  const { accountRows, txRows, portfolio, liabilityRows, updates, liabilityTxs } = await readLedgerWorld(userId);
  const ledger = txRows.map(toLedgerTx);
  return dates.map((date) => {
    const upTo = ledger.filter((t) => t.date <= date);
    const cash = accountRows.reduce((sum, a) => sum + accountBalance(a.openingBalance, a.id, upTo), 0);
    const holdingsValue = valuePortfolio(portfolio, date).total;
    const owed = liabilityRows.reduce(
      (sum, l) =>
        sum +
        outstandingOf(
          l,
          updates.filter((u) => u.liabilityId === l.id),
          liabilityTxs.filter((t) => t.liabilityId === l.id),
          date,
        ),
      0,
    );
    return { date, cash, holdings: holdingsValue, liabilities: owed, netWorth: netWorth({ cash, holdings: holdingsValue, liabilities: owed }) };
  });
}

export async function loadNetWorthAsOf(userId: string, date: string): Promise<NetWorthSnapshot> {
  return (await loadNetWorthSnapshots(userId, [date]))[0];
}

/** Goals, allocations, rules and overrides, read in the same children-first order. */
async function readPlanning(userId: string) {
  const goalAllocationEvents = await listAllocationEvents(userId);
  const goalAllocations = await listGoalAllocations(userId);
  const allocationRules = await listRules(userId);
  // Rules can be deleted (their overrides go with them); drop overrides of a rule created after the rules were read.
  const ruleIds = new Set(allocationRules.map((r) => r.id));
  const allocationOverrides = (await listOverrides(userId)).filter((o) => ruleIds.has(o.ruleId));
  const goals = await listGoals(userId, { includeArchived: true });
  return { goals, goalAllocations, goalAllocationEvents, allocationRules, allocationOverrides };
}

/** Children first (prices, rates, confirmations, loan updates), then the holdings and loans they point at. */
async function readInvestments(userId: string) {
  const wealth = await listWealthRows(userId);
  const priceUpdates = await listPriceUpdateRows(userId);
  const corporateActions = await listCorporateActions(userId);
  const holdings = await listHoldings(userId, { includeArchived: true });
  return { ...wealth, holdings, priceUpdates, corporateActions };
}

/**
 * Every table the backup holds, read children first and then what they point at: accounts, categories, goals and
 * recurring templates are never hard-deleted, so everything a row points at is still there by the time it is read, even
 * if a write lands in between. The return type is left to inference on purpose: the export route passes it to
 * serializeBackup and lib/backup.test.ts assigns it to BackupRows, so a table left out here fails the typecheck.
 */
export async function loadBackupRows(userId: string) {
  const transactionRows = await listTransactions(userId);
  const templateRows = await listRecurringTemplates(userId);
  const planning = await readPlanning(userId);
  const investments = await readInvestments(userId);
  const budgetRows = await listBudgets(userId);
  const accountRows = await listAccounts(userId, { includeArchived: true });
  const categoryRows = await listCategories(userId, { includeArchived: true });
  const thresholds = await getBudgetThresholds(userId);
  const settings = {
    ...(await getSettings(userId)),
    ...(await getPlanSettings(userId)),
    ...(await readInsightSettings(userId)),
    staleDaysHoldings: await getStaleDays(userId),
    budgetWarnAt: thresholds.warnAt,
    budgetAlertAt: thresholds.alertAt,
  };
  return {
    settings,
    accounts: accountRows,
    categories: categoryRows,
    transactions: transactionRows,
    assumptions: await getAssumptions(userId),
    budgets: budgetRows,
    recurringTemplates: templateRows,
    ...planning,
    ...investments,
  };
}

// ---- Phase 5b: history, allocation, insights, scenario defaults, reminders ----

/** The settings columns phase 5b added, flat and in the shape the backup stores them. */
async function readInsightSettings(userId: string) {
  const [row] = await db
    .select({
      targetStocks: userSettings.targetStocks,
      targetGold: userSettings.targetGold,
      targetClouds: userSettings.targetClouds,
      targetCash: userSettings.targetCash,
      insightMinPercent: userSettings.insightMinPercent,
      insightMinAmount: userSettings.insightMinAmount,
      remindReview: userSettings.remindReview,
      remindRecurring: userSettings.remindRecurring,
      remindStale: userSettings.remindStale,
      remindGoal: userSettings.remindGoal,
      remindBudget: userSettings.remindBudget,
      remindSavings: userSettings.remindSavings,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return {
    targetStocks: rateOrNull(row?.targetStocks ?? null),
    targetGold: rateOrNull(row?.targetGold ?? null),
    targetClouds: rateOrNull(row?.targetClouds ?? null),
    targetCash: rateOrNull(row?.targetCash ?? null),
    insightMinPercent: row ? Number(row.insightMinPercent) : DEFAULT_NOTABLE_PERCENT,
    insightMinAmount: row?.insightMinAmount ?? DEFAULT_NOTABLE_AMOUNT,
    remindReview: row?.remindReview ?? true,
    remindRecurring: row?.remindRecurring ?? true,
    remindStale: row?.remindStale ?? true,
    remindGoal: row?.remindGoal ?? true,
    remindBudget: row?.remindBudget ?? true,
    remindSavings: row?.remindSavings ?? true,
  };
}

type InsightSettings = Awaited<ReturnType<typeof readInsightSettings>>;

const targetsOf = (s: InsightSettings): Targets | null =>
  s.targetStocks === null || s.targetGold === null || s.targetClouds === null || s.targetCash === null
    ? null
    : { stocks: s.targetStocks, gold: s.targetGold, clouds: s.targetClouds, cash: s.targetCash };

const thresholdsOf = (s: InsightSettings) => ({ percent: s.insightMinPercent, amount: s.insightMinAmount });

const switchesOf = (s: InsightSettings): ReminderSwitches => ({
  review: s.remindReview,
  recurring: s.remindRecurring,
  stale: s.remindStale,
  goal: s.remindGoal,
  budget: s.remindBudget,
  savings: s.remindSavings,
});

/** The target share of each class (decimals), or null when none is set. */
export async function getPortfolioTargets(userId: string): Promise<Targets | null> {
  return targetsOf(await readInsightSettings(userId));
}

/** A spending change is an insight only if it reaches both: a share (0.15 = 15%) and an amount in piasters. */
export async function getInsightThresholds(userId: string): Promise<{ percent: number; amount: Piasters }> {
  return thresholdsOf(await readInsightSettings(userId));
}

/** Every reminder kind is on until the user switches it off. */
export async function getReminderSwitches(userId: string): Promise<ReminderSwitches> {
  return switchesOf(await readInsightSettings(userId));
}

/**
 * Net worth, cash, investments and debt as of each date (at most MAX_POINTS), replayed from one load of the user's
 * records (H1): nothing is stored, so a back-dated record changes the past by itself. Pass samplingDates(...) for a range.
 */
export async function loadHistory(userId: string, dates: string[]): Promise<HistoryPoint[]> {
  if (dates.length > MAX_POINTS) throw new RangeError(`History is limited to ${MAX_POINTS} dates per request`);
  const { accountRows, txRows, portfolio, liabilityRows, updates, liabilityTxs } = await readLedgerWorld(userId);
  const data: HistoryData = {
    accounts: accountRows.map((a) => ({ id: a.id, opening: a.openingBalance, creditCard: a.type === "credit_card" })),
    txs: txRows.map(toLedgerTx),
    liabilities: liabilityRows.map((l) => ({
      opening: l.openingBalance,
      updates: updates.filter((u) => u.liabilityId === l.id).map((u) => ({ date: u.date, delta: u.delta })),
      payments: liabilityTxs
        .filter((t) => t.liabilityId === l.id && t.type === "LIABILITY_PAYMENT" && t.status === "posted")
        .map((t) => ({ date: t.date, amount: t.amount })),
    })),
    investmentsAt: (date) => {
      const v = valuePortfolio(portfolio, date);
      return { total: v.total, stale: v.stale };
    },
  };
  return seriesFromSnapshots(snapshotsAsOf(data, dates));
}

/**
 * What each asset class is worth now. Cash is every account that is not a credit card plus a positive card balance;
 * a negative card balance is `cardDebt` (a positive figure). Archived accounts still hold money, so they count.
 */
export function classValues(
  wealth: Pick<WealthData, "valuation" | "portfolio">,
  accountRows: Pick<AccountRow, "id" | "type">[],
  balances: Map<string, Piasters>,
): { values: Record<MixClass, Piasters>; cardDebt: Piasters } {
  const kindOf = new Map(wealth.portfolio.holdings.map((h) => [h.id, h.kind]));
  const gold = wealth.valuation.lines.filter((l) => kindOf.get(l.id) === "gold").reduce((s, l) => s + l.value, 0);
  const stocks = wealth.valuation.lines.reduce((s, l) => s + l.value, 0) - gold;
  const clouds = wealth.valuation.clouds.reduce((s, c) => s + c.value, 0);
  let cash = 0;
  let cardDebt = 0;
  for (const a of accountRows) {
    const b = balances.get(a.id) ?? 0;
    if (a.type !== "credit_card" || b >= 0) cash += b;
    else cardDebt -= b;
  }
  return { values: { stocks, gold, clouds, cash }, cardDebt };
}

/** Investment values past their stale limit: how many and what they are worth. */
function staleOf(valuation: PortfolioValuation): { count: number; value: Piasters } {
  const stale = [...valuation.lines.filter((l) => l.stale), ...valuation.clouds.filter((c) => c.stale)];
  return { count: stale.length, value: stale.reduce((s, x) => s + x.value, 0) };
}

const sumOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

const firstPosted = (rows: Pick<TransactionRow, "status" | "date">[]): string | null =>
  rows.reduce<string | null>((min, r) => (r.status !== "posted" || (min !== null && min <= r.date) ? min : r.date), null);

/**
 * What the planning loaders cannot read for themselves: the goal and budget figures the caller already worked out
 * (Home does), and any rows it already read, which are then not read again.
 */
export type PlanningContext = {
  goalData: GoalData;
  budgets: BudgetLine[];
  accounts?: AccountRow[];
  txRows?: TransactionRow[];
  wealth?: WealthData;
};

const activeGoals = (goalData: GoalData) => goalData.goals.filter((v) => !v.goal.archivedAt);

/** Everything buildInsights needs. Its own reads are the settings, categories, pending items and whatever the context lacks. */
export async function loadInsightInput(userId: string, ctx: PlanningContext): Promise<InsightInput> {
  const { goalData } = ctx;
  const { today, startDay } = goalData;
  const [settings, categoryRows, pendingRows, accountRows, txRows, wealth] = await Promise.all([
    readInsightSettings(userId),
    listCategories(userId, { includeArchived: true }),
    listPendingRecurring(userId),
    ctx.accounts ?? listAccounts(userId, { includeArchived: true }),
    ctx.txRows ?? listTransactions(userId),
    ctx.wealth ?? loadWealth(userId, today),
  ]);

  const ledger = txRows.map(toLedgerTx);
  const ranges = fullMonths(firstPosted(txRows), today, startDay, 4);
  const earlierMonths = ranges.slice(-3);
  const cashAccounts = accountRows.filter((a) => !a.isInvestment && a.type !== "credit_card");
  const cashAt = (date: string) =>
    sumOf(cashAccounts.map((a) => accountBalance(a.openingBalance, a.id, ledger.filter((t) => t.date <= date))));
  const months = ranges.map((r) => {
    const s = periodSummary(filterByDateRange(ledger, r.start, r.end));
    return { saved: s.savings, cashChange: cashAt(r.end) - cashAt(addDays(r.start, -1)), invested: s.netInvested };
  });
  const windowStart = earlierMonths.length > 0 ? earlierMonths[0].start : goalData.month.start;

  const { values } = classValues(wealth, accountRows, accountBalances(accountRows, txRows));
  return {
    today,
    thresholds: thresholdsOf(settings),
    spending: {
      txs: txRows.filter((r) => r.date >= windowStart && r.date <= goalData.month.end).map(toAnalyticsTx),
      currentMonth: goalData.month,
      earlierMonths,
      categoryNames: Object.fromEntries(categoryRows.map((c) => [c.id, c.name])),
    },
    months,
    // In flexible mode the "target" is just capacity, not something the owner set, so there is nothing to miss.
    savingsTarget: goalData.settings.savingsTargetMode !== "flexible" && goalData.plan.target > 0 ? goalData.plan.target : null,
    goals: activeGoals(goalData).map((v) => ({
      id: v.goal.id,
      name: v.goal.name,
      onTrack: v.projection.onTrack,
      monthsLate: v.projection.monthsLate,
      gap: v.projection.gap,
    })),
    mix: mix(values),
    budgets: ctx.budgets.map((b) => ({ id: b.id, name: b.categoryId ? b.name : "overall", status: b.status })),
    stale: staleOf(wealth.valuation),
    pending: { count: pendingRows.length, total: sumOf(pendingRows.map((r) => r.amount)) },
  };
}

/** The reminder input, from the same context as the insights. buildReminders applies the switches (getReminderSwitches). */
export async function loadReminderInput(userId: string, ctx: PlanningContext): Promise<ReminderInput> {
  const { goalData } = ctx;
  const { today, startDay, month } = goalData;
  const [pendingRows, txRows, wealth] = await Promise.all([
    listPendingRecurring(userId),
    ctx.txRows ?? listTransactions(userId),
    ctx.wealth ?? loadWealth(userId, today),
  ]);

  const previous = financialMonth(addDays(month.start, -1), startDay);
  const last = fullMonths(firstPosted(txRows), today, startDay, 1)[0];
  // Flexible mode has no target the owner set; 0 switches the reminder off.
  const target = goalData.settings.savingsTargetMode === "flexible" ? 0 : goalData.plan.target;
  return {
    month,
    previousMonthHasData: txRows.some((r) => r.status === "posted" && r.date >= previous.start && r.date <= previous.end),
    pendingRecurring: { count: pendingRows.length, total: sumOf(pendingRows.map((r) => r.amount)) },
    staleCount: staleOf(wealth.valuation).count,
    goals: activeGoals(goalData).map((v) => ({ id: v.goal.id, name: v.goal.name, planned: v.planned, actual: v.actual })),
    budgets: ctx.budgets.map((b) => ({ id: b.id, name: b.categoryId ? b.name : "overall", status: b.status })),
    lastMonthSavings:
      last && target > 0
        ? { saved: periodSummary(filterByDateRange(txRows.map(toLedgerTx), last.start, last.end)).savings, target }
        : null,
  };
}

export type ScenarioDefaults = {
  input: ScenarioInput;
  /** Where income and spending came from: the trailing 3-month average or the figures entered in settings. */
  basis: "average" | "entered";
  /** Neither history nor entered figures: income and spending are 0. */
  inputsMissing: boolean;
  /** Classes with no assumed return anywhere (counted as 0%). */
  returnsMissing: MixClass[];
  /** Some investment values are out of date. */
  stale: boolean;
};

type GoalSource = GoalData["goals"][number]["allocations"][number];

const goalClass = (a: GoalSource): MixClass =>
  a.kind === "cash" ? "cash" : a.holdingKind === "gold" ? "gold" : a.holdingKind === "cloud" ? "clouds" : "stocks";

/**
 * The calculator's starting figures, all from the user's own data: income and spending as the plan uses them, monthly
 * investing as the average net purchases of the last full months (2 needed), returns from the assumptions (a cloud with
 * no assumption uses the value-weighted APY of the clouds held), and today's value of each class. The invested part is
 * split by today's mix of stocks, gold and clouds: the allocation rules aim at goals, not asset classes.
 */
export async function loadScenarioDefaults(
  userId: string,
  ctx: Pick<PlanningContext, "goalData" | "accounts" | "txRows" | "wealth">,
): Promise<ScenarioDefaults> {
  const { goalData } = ctx;
  const { today, startDay } = goalData;
  const [accountRows, txRows, wealth] = await Promise.all([
    ctx.accounts ?? listAccounts(userId, { includeArchived: true }),
    ctx.txRows ?? listTransactions(userId),
    ctx.wealth ?? loadWealth(userId, today),
  ]);

  const ledger = txRows.map(toLedgerTx);
  const invested = trailingAverage(
    fullMonths(firstPosted(txRows), today, startDay, 3).map((r) => periodSummary(filterByDateRange(ledger, r.start, r.end)).netInvested),
  );
  const { values, cardDebt } = classValues(wealth, accountRows, accountBalances(accountRows, txRows));

  const { assumptions } = goalData;
  const withApy = wealth.valuation.clouds.filter((c) => c.apy !== null);
  const cloudValue = sumOf(withApy.map((c) => c.value));
  const cloudApy = assumptions.savingsCloudApy ?? (cloudValue > 0 ? sumOf(withApy.map((c) => c.value * c.apy!)) / cloudValue : null);
  const assumed: Record<MixClass, number | null> = {
    stocks: assumptions.stockReturn,
    gold: assumptions.goldReturn,
    clouds: cloudApy,
    cash: assumptions.cashReturn,
  };

  const input: ScenarioInput = {
    today,
    startDay,
    monthlyIncome: goalData.plan.income,
    incomeGrowth: assumptions.incomeGrowth ?? 0,
    monthlySpending: goalData.plan.spending,
    monthlySavings: null,
    monthlyInvestment: invested.kind === "average" ? Math.max(0, invested.value) : 0,
    returns: { stocks: assumed.stocks ?? 0, gold: assumed.gold ?? 0, clouds: assumed.clouds ?? 0, cash: assumed.cash ?? 0 },
    startValues: values,
    investSplit: null,
    liabilities: wealth.liabilitiesTotal + cardDebt,
    years: 10,
    inflation: assumptions.inflation,
    goals: activeGoals(goalData).map((v) => ({
      id: v.goal.id,
      name: v.goal.name,
      target: v.goal.targetAmount,
      targetDate: v.goal.targetDate,
      current: v.current,
      plannedMonthly: v.planned,
      sources: v.allocations.map((a) => ({ class: goalClass(a), value: a.kind === "cash" ? a.amount : a.value })),
      returnOverride: v.goal.expectedReturnOverride,
      contributedThisMonth: v.actual > 0,
    })),
  };
  return {
    input,
    basis: goalData.plan.basis,
    inputsMissing: goalData.plan.inputsMissing,
    returnsMissing: MIX_CLASSES.filter((c) => assumed[c] === null),
    stale: wealth.valuation.stale,
  };
}
