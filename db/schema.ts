import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUid, authUsers, authenticatedRole } from "drizzle-orm/supabase";

// All money columns are integer piasters held in a JS number (see lib/finance-core/money.ts).
const piasters = (name: string) => bigint(name, { mode: "number" });

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" });

const ownerOnly = (table: string) =>
  pgPolicy(`${table}_owner_all`, {
    as: "permissive",
    for: "all",
    to: authenticatedRole,
    using: sql`user_id = ${authUid}`,
    withCheck: sql`user_id = ${authUid}`,
  });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const accountType = pgEnum("account_type", [
  "bank",
  "cash",
  "wallet",
  "brokerage",
  "savings",
  "credit_card",
  "receivable",
  "other",
]);
export const categoryKind = pgEnum("category_kind", ["income", "expense"]);
export const transactionType = pgEnum("transaction_type", [
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "INVESTMENT_PURCHASE",
  "INVESTMENT_SALE",
  "LIABILITY_PAYMENT",
  "DIVIDEND",
  "INTEREST",
  "ADJUSTMENT",
]);
export const transactionStatus = pgEnum("transaction_status", ["pending", "posted", "void"]);
export const holdingKind = pgEnum("holding_kind", ["stock", "fund", "other", "gold", "cloud"]);
export const goldForm = pgEnum("gold_form", ["bar", "coin", "jewelry"]);
export const contributionFrequency = pgEnum("contribution_frequency", ["weekly", "monthly"]);
export const goldPriceMode = pgEnum("gold_price_mode", ["derive_24k", "per_karat"]);
export const liabilityKind = pgEnum("liability_kind", ["loan", "owed", "other"]);
export const corporateActionKind = pgEnum("corporate_action_kind", ["BONUS", "SPLIT", "WRITE_OFF"]);
export const savingsTargetMode = pgEnum("savings_target_mode", ["fixed", "percentage", "flexible"]);
export const allocationRuleKind = pgEnum("allocation_rule_kind", ["fixed", "percentage", "remainder"]);
export const allocationTargetKind = pgEnum("allocation_target_kind", ["goal", "investments", "cash"]);

export const userSettings = pgTable(
  "user_settings",
  {
    userId: userId().primaryKey(),
    monthStartDay: integer("month_start_day").notNull().default(1),
    savingsTargetMode: savingsTargetMode("savings_target_mode").notNull().default("flexible"),
    savingsTargetAmount: piasters("savings_target_amount"),
    savingsTargetPercent: numeric("savings_target_percent", { precision: 8, scale: 6 }),
    expectedMonthlyIncome: piasters("expected_monthly_income"),
    expectedMonthlySpending: piasters("expected_monthly_spending"),
    staleDaysHoldings: integer("stale_days_holdings").notNull().default(7),
    goldPriceMode: goldPriceMode("gold_price_mode").notNull().default("derive_24k"),
    staleDaysGold: integer("stale_days_gold").notNull().default(14),
    staleDaysClouds: integer("stale_days_clouds").notNull().default(30),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check("user_settings_month_start_day_range", sql`month_start_day between 1 and 28`),
    check("user_settings_stale_days_holdings_range", sql`stale_days_holdings between 1 and 365`),
    check("user_settings_stale_days_gold_range", sql`stale_days_gold between 1 and 365`),
    check("user_settings_stale_days_clouds_range", sql`stale_days_clouds between 1 and 365`),
    ownerOnly("user_settings"),
  ],
).enableRLS();

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    institution: text("institution"),
    notes: text("notes"),
    isInvestment: boolean("is_investment").notNull().default(false),
    openingBalance: piasters("opening_balance").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [ownerOnly("accounts")],
).enableRLS();

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    isEssential: boolean("is_essential").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique("categories_user_kind_name_unique").on(t.userId, t.kind, t.name), ownerOnly("categories")],
).enableRLS();

// Quantities and unit prices are NUMERIC(20,6) and travel as decimal strings (lib/finance-core/holdings.ts).
const decimal6 = (name: string) => numeric(name, { precision: 20, scale: 6 });

// Holdings: unit-based (stock, fund, other), physical gold (grams, with karat and form) or a value-based Savings Cloud.
// Quantity, cost basis and P/L are replayed from events, never stored.
export const holdings = pgTable(
  "holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: holdingKind("kind").notNull(),
    name: text("name").notNull(),
    ticker: text("ticker"),
    notes: text("notes"),
    // Gold only.
    karat: integer("karat"),
    form: goldForm("form"),
    // Savings Cloud only; the contribution is used for projections, never booked.
    startDate: date("start_date", { mode: "string" }),
    maturityDate: date("maturity_date", { mode: "string" }),
    contributionAmount: piasters("contribution_amount"),
    contributionFrequency: contributionFrequency("contribution_frequency"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // ::text, not the enum literal: 'gold' and 'cloud' are added in the same migration transaction and cannot be used until it commits.
    check(
      "holdings_gold_fields_check",
      sql`(${t.kind}::text = 'gold' and ${t.karat} in (24, 21, 18) and ${t.form} is not null)
        or (${t.kind}::text <> 'gold' and ${t.karat} is null and ${t.form} is null)`,
    ),
    check(
      "holdings_cloud_fields_check",
      sql`${t.kind}::text = 'cloud' or (
        ${t.startDate} is null and ${t.maturityDate} is null
        and ${t.contributionAmount} is null and ${t.contributionFrequency} is null
      )`,
    ),
    check(
      "holdings_cloud_values_check",
      sql`(${t.maturityDate} is null or ${t.startDate} is null or ${t.maturityDate} >= ${t.startDate})
        and (${t.contributionAmount} is null) = (${t.contributionFrequency} is null)
        and (${t.contributionAmount} is null or ${t.contributionAmount} > 0)`,
    ),
    ownerOnly("holdings"),
  ],
).enableRLS();

// Money owed by the user. Credit cards stay accounts. Balance = opening + updates - posted principal payments.
export const liabilities = pgTable(
  "liabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    name: text("name").notNull(),
    kind: liabilityKind("kind").notNull(),
    openingBalance: piasters("opening_balance").notNull(),
    // Display only; interest actually paid is entered per payment.
    interestRate: numeric("interest_rate", { precision: 8, scale: 6 }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("liabilities_opening_balance_check", sql`${t.openingBalance} > 0`),
    check("liabilities_interest_rate_check", sql`${t.interestRate} is null or ${t.interestRate} >= 0`),
    ownerOnly("liabilities"),
  ],
).enableRLS();

// Append-only: a change that moves no cash (borrowed more, correction). Signed: + owes more, - owes less.
export const liabilityUpdates = pgTable(
  "liability_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    liabilityId: uuid("liability_id")
      .notNull()
      .references(() => liabilities.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    delta: piasters("delta").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    check("liability_updates_delta_check", sql`${t.delta} <> 0`),
    index("liability_updates_liability_date_idx").on(t.liabilityId, t.date),
    ownerOnly("liability_updates"),
  ],
).enableRLS();

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    type: transactionType("type").notNull(),
    // Cairo calendar date as 'YYYY-MM-DD'; string mode avoids timezone shifts.
    date: date("date", { mode: "string" }).notNull(),
    amount: piasters("amount").notNull(),
    fromAccountId: uuid("from_account_id").references(() => accounts.id),
    toAccountId: uuid("to_account_id").references(() => accounts.id),
    categoryId: uuid("category_id").references(() => categories.id),
    note: text("note"),
    status: transactionStatus("status").notNull().default("posted"),
    fee: piasters("fee").notNull().default(0),
    grossAmount: piasters("gross_amount"),
    taxWithheld: piasters("tax_withheld"),
    realizedPl: piasters("realized_pl"),
    holdingId: uuid("holding_id").references(() => holdings.id),
    quantity: decimal6("quantity"),
    unitPrice: decimal6("unit_price"),
    liabilityId: uuid("liability_id").references(() => liabilities.id),
    replacesId: uuid("replaces_id").references((): AnyPgColumn => transactions.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("transactions_amount_check", sql`${t.amount} <> 0 and (${t.type} = 'ADJUSTMENT' or ${t.amount} > 0)`),
    check(
      "transactions_accounts_by_type_check",
      sql`(
        ${t.type} in ('INCOME', 'DIVIDEND', 'INTEREST', 'INVESTMENT_SALE', 'ADJUSTMENT')
          and ${t.toAccountId} is not null and ${t.fromAccountId} is null
      ) or (
        ${t.type} in ('EXPENSE', 'INVESTMENT_PURCHASE', 'LIABILITY_PAYMENT')
          and ${t.fromAccountId} is not null and ${t.toAccountId} is null
      ) or (
        ${t.type} = 'TRANSFER'
          and ${t.fromAccountId} is not null and ${t.toAccountId} is not null
          and ${t.fromAccountId} <> ${t.toAccountId}
      )`,
    ),
    check("transactions_fee_tax_non_negative_check", sql`${t.fee} >= 0 and coalesce(${t.taxWithheld}, 0) >= 0`),
    check(
      "transactions_holding_type_check",
      sql`${t.holdingId} is null or ${t.type} in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE', 'DIVIDEND')`,
    ),
    check(
      "transactions_liability_type_check",
      sql`${t.liabilityId} is null or ${t.type} in ('LIABILITY_PAYMENT', 'EXPENSE')`,
    ),
    // Quantity and unit price travel together on investment rows: both set (unit-based, gold) or both null (cloud
    // deposit or withdrawal). Which one is right depends on the holding's kind, which only application code can see.
    check(
      "transactions_quantity_price_check",
      sql`(
        ${t.type} in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE') and ${t.holdingId} is not null
          and (
            (${t.quantity} is not null and ${t.quantity} > 0 and ${t.unitPrice} is not null and ${t.unitPrice} >= 0)
            or (${t.quantity} is null and ${t.unitPrice} is null)
          )
      ) or (
        (${t.type} not in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE') or ${t.holdingId} is null)
          and ${t.quantity} is null and ${t.unitPrice} is null
      )`,
    ),
    index("transactions_user_date_idx").on(t.userId, t.date),
    index("transactions_from_account_idx").on(t.fromAccountId),
    index("transactions_to_account_idx").on(t.toAccountId),
    ownerOnly("transactions"),
  ],
).enableRLS();

// Append-only: a price is never edited, a newer row supersedes it (step function by date).
export const priceUpdates = pgTable(
  "price_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    price: decimal6("price").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("price_updates_price_check", sql`${t.price} >= 0`),
    index("price_updates_holding_date_idx").on(t.holdingId, t.date),
    ownerOnly("price_updates"),
  ],
).enableRLS();

// Append-only, no cash. BONUS adds quantity, SPLIT multiplies it by ratio, WRITE_OFF zeroes quantity and cost basis.
export const corporateActions = pgTable(
  "corporate_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    kind: corporateActionKind("kind").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    quantity: decimal6("quantity"),
    ratio: decimal6("ratio"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "corporate_actions_kind_values_check",
      sql`(
        ${t.kind} = 'BONUS' and ${t.quantity} is not null and ${t.quantity} > 0 and ${t.ratio} is null
      ) or (
        ${t.kind} = 'SPLIT' and ${t.ratio} is not null and ${t.ratio} > 0 and ${t.quantity} is null
      ) or (
        ${t.kind} = 'WRITE_OFF' and ${t.quantity} is null and ${t.ratio} is null
      )`,
    ),
    index("corporate_actions_holding_date_idx").on(t.holdingId, t.date),
    ownerOnly("corporate_actions"),
  ],
).enableRLS();

// Nullable on purpose: assumptions are user-set, never hard-coded defaults.
const rate = (name: string) => numeric(name, { precision: 8, scale: 6 });

// Gold prices are global, not per holding: the BUY-BACK price per gram. Append-only, a newer row supersedes (step function).
// In derive_24k mode only karat 24 rows are used; the other karats are derived.
export const goldPrices = pgTable(
  "gold_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    date: date("date", { mode: "string" }).notNull(),
    karat: integer("karat").notNull(),
    buybackPrice: decimal6("buyback_price").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("gold_prices_karat_check", sql`${t.karat} in (24, 21, 18)`),
    check("gold_prices_price_check", sql`${t.buybackPrice} >= 0`),
    index("gold_prices_user_karat_date_idx").on(t.userId, t.karat, t.date),
    ownerOnly("gold_prices"),
  ],
).enableRLS();

// Append-only: an APY change is a new row with an effective date, never an edit. Effective annual rate (0.20 = 20%).
export const rateHistory = pgTable(
  "rate_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    apy: rate("apy").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("rate_history_apy_check", sql`${t.apy} > -1`),
    index("rate_history_holding_date_idx").on(t.holdingId, t.effectiveDate),
    ownerOnly("rate_history"),
  ],
).enableRLS();

// Append-only: the value the user read off the product. The latest one is the anchor of the cloud's estimate.
export const cloudConfirmations = pgTable(
  "cloud_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    value: piasters("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("cloud_confirmations_value_check", sql`${t.value} >= 0`),
    index("cloud_confirmations_holding_date_idx").on(t.holdingId, t.date),
    ownerOnly("cloud_confirmations"),
  ],
).enableRLS();

export const financialAssumptions = pgTable(
  "financial_assumptions",
  {
    userId: userId().primaryKey(),
    stockReturn: rate("stock_return"),
    goldReturn: rate("gold_return"),
    savingsCloudApy: rate("savings_cloud_apy"),
    cashReturn: rate("cash_return"),
    inflation: rate("inflation"),
    updatedAt: updatedAt(),
  },
  () => [ownerOnly("financial_assumptions")],
).enableRLS();

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    name: text("name").notNull(),
    targetAmount: piasters("target_amount").notNull(),
    targetDate: date("target_date", { mode: "string" }).notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    priority: integer("priority").notNull(),
    plannedMonthly: piasters("planned_monthly"),
    expectedReturnOverride: rate("expected_return_override"),
    manualCurrent: piasters("manual_current"),
    notes: text("notes"),
    color: text("color"),
    icon: text("icon"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("goals_target_amount_check", sql`${t.targetAmount} > 0`),
    check("goals_priority_check", sql`${t.priority} >= 1`),
    check("goals_planned_monthly_check", sql`${t.plannedMonthly} is null or ${t.plannedMonthly} >= 0`),
    check("goals_manual_current_check", sql`${t.manualCurrent} is null or ${t.manualCurrent} >= 0`),
    ownerOnly("goals"),
  ],
).enableRLS();

// A goal is an earmark. A cash allocation holds a fixed amount of an account's money; a holding allocation is a
// percentage share (0 < p <= 1) of a holding's current value, so it moves with the market. Neither moves any money.
export const goalAllocations = pgTable(
  "goal_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id),
    amount: piasters("amount"),
    holdingId: uuid("holding_id").references(() => holdings.id),
    percent: rate("percent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "goal_allocations_shape_check",
      sql`(
        ${t.accountId} is not null and ${t.amount} is not null and ${t.amount} > 0
          and ${t.holdingId} is null and ${t.percent} is null
      ) or (
        ${t.holdingId} is not null and ${t.percent} is not null and ${t.percent} > 0 and ${t.percent} <= 1
          and ${t.accountId} is null and ${t.amount} is null
      )`,
    ),
    unique("goal_allocations_goal_account_unique").on(t.goalId, t.accountId),
    unique("goal_allocations_goal_holding_unique").on(t.goalId, t.holdingId),
    ownerOnly("goal_allocations"),
  ],
).enableRLS();

// Append-only history of every allocation change; contributions are read from here.
export const goalAllocationEvents = pgTable(
  "goal_allocation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id),
    holdingId: uuid("holding_id").references(() => holdings.id),
    // Signed share change for a holding event; `delta` stays the EGP value of the change at that moment.
    percentDelta: rate("percent_delta"),
    delta: piasters("delta").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    check("goal_allocation_events_delta_check", sql`${t.delta} <> 0`),
    check(
      "goal_allocation_events_shape_check",
      sql`(
        ${t.accountId} is not null and ${t.holdingId} is null and ${t.percentDelta} is null
      ) or (
        ${t.holdingId} is not null and ${t.accountId} is null and ${t.percentDelta} is not null and ${t.percentDelta} <> 0
      )`,
    ),
    index("goal_allocation_events_user_date_idx").on(t.userId, t.date),
    ownerOnly("goal_allocation_events"),
  ],
).enableRLS();

export const allocationRules = pgTable(
  "allocation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    kind: allocationRuleKind("kind").notNull(),
    targetKind: allocationTargetKind("target_kind").notNull(),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
    amount: piasters("amount"),
    percent: rate("percent"),
    createdAt: createdAt(),
  },
  (t) => [
    check("allocation_rules_goal_target_check", sql`(${t.goalId} is not null) = (${t.targetKind} = 'goal')`),
    check(
      "allocation_rules_kind_values_check",
      sql`(
        ${t.kind} = 'fixed' and ${t.amount} is not null and ${t.amount} > 0 and ${t.percent} is null
      ) or (
        ${t.kind} = 'percentage' and ${t.percent} is not null and ${t.percent} > 0 and ${t.percent} <= 1 and ${t.amount} is null
      ) or (
        ${t.kind} = 'remainder' and ${t.amount} is null and ${t.percent} is null
      )`,
    ),
    uniqueIndex("allocation_rules_one_remainder_idx").on(t.userId).where(sql`${t.kind} = 'remainder'`),
    ownerOnly("allocation_rules"),
  ],
).enableRLS();

export const allocationOverrides = pgTable(
  "allocation_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => allocationRules.id, { onDelete: "cascade" }),
    // Start month of the financial month, 'YYYY-MM'.
    month: text("month").notNull(),
    amount: piasters("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("allocation_overrides_month_check", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("allocation_overrides_amount_check", sql`${t.amount} >= 0`),
    unique("allocation_overrides_rule_month_unique").on(t.ruleId, t.month),
    ownerOnly("allocation_overrides"),
  ],
).enableRLS();
