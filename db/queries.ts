import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import type { SavingsTargetMode } from "@/lib/finance-core/allocation";
import { accountBalance, type Tx } from "@/lib/finance-core/ledger";
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
import { cairoToday } from "@/lib/finance-core/time";
import { eventsByHolding, type LedgerEvent, toHoldingEvents } from "@/lib/backup";
import { db } from "./index";
import {
  accounts,
  allocationOverrides,
  allocationRules,
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
