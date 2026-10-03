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

export const userSettings = pgTable(
  "user_settings",
  {
    userId: userId().primaryKey(),
    monthStartDay: integer("month_start_day").notNull().default(1),
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
