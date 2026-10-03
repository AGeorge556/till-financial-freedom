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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check("user_settings_month_start_day_range", sql`month_start_day between 1 and 28`),
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
    index("transactions_user_date_idx").on(t.userId, t.date),
    index("transactions_from_account_idx").on(t.fromAccountId),
    index("transactions_to_account_idx").on(t.toAccountId),
    ownerOnly("transactions"),
  ],
).enableRLS();

// Nullable on purpose: assumptions are user-set, never hard-coded defaults.
const rate = (name: string) => numeric(name, { precision: 8, scale: 6 });

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

// A goal is an earmark: it holds fixed amounts of money that stays in the account.
export const goalAllocations = pgTable(
  "goal_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userId(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    amount: piasters("amount").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("goal_allocations_amount_check", sql`${t.amount} > 0`),
    unique("goal_allocations_goal_account_unique").on(t.goalId, t.accountId),
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
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    delta: piasters("delta").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    check("goal_allocation_events_delta_check", sql`${t.delta} <> 0`),
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
