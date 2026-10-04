import type { RuleKind, SavingsTargetMode, TargetKind } from "./finance-core/allocation";
import { DEFAULT_NOTABLE_AMOUNT, DEFAULT_NOTABLE_PERCENT } from "./finance-core/analytics";
import { type CashFlow, type Confirmation, DEFAULT_STALE_DAYS_CLOUDS, type RateChange, validateCloudHistory } from "./finance-core/clouds";
import { DEFAULT_STALE_DAYS_GOLD, type GoldPriceMode, KARATS } from "./finance-core/gold";
import { DEFAULT_BUDGET_ALERT_AT, DEFAULT_BUDGET_WARN_AT } from "./finance-core/budget";
import { lineValue } from "./finance-core/holdings";
import type { TxType } from "./finance-core/ledger";
import { validateLiabilityHistory } from "./finance-core/liabilities";
import type { Piasters } from "./finance-core/money";
import { DEFAULT_STALE_DAYS, type HoldingEvent, purchaseCash, saleCash, validateHistory } from "./finance-core/portfolio";
import { validateTargets } from "./finance-core/portfolioMix";

// Pure: no React, Next.js or database imports. The enum lists below mirror db/schema.ts (backup.test.ts checks they match).

export const BACKUP_VERSION = 6;
// Version 1 files (no goals, rules or savings settings), version 2 files (no holdings), version 3 files
// (no gold, clouds, liabilities or holding shares), version 4 files (no budgets, recurring items or expense-based goal
// targets) and version 5 files (no portfolio targets, insight thresholds, reminder switches or income growth) still restore.
const OLDEST_VERSION = 1;

export const ACCOUNT_TYPES = ["bank", "cash", "wallet", "brokerage", "savings", "credit_card", "receivable", "other"] as const;
export const CATEGORY_KINDS = ["income", "expense"] as const;
export const TX_TYPES = [
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "INVESTMENT_PURCHASE",
  "INVESTMENT_SALE",
  "LIABILITY_PAYMENT",
  "DIVIDEND",
  "INTEREST",
  "ADJUSTMENT",
] as const satisfies readonly TxType[];
export const TX_STATUSES = ["pending", "posted", "void"] as const;
export const HOLDING_KINDS = ["stock", "fund", "other", "gold", "cloud"] as const;
export const GOLD_FORMS = ["bar", "coin", "jewelry"] as const;
export const CONTRIBUTION_FREQUENCIES = ["weekly", "monthly"] as const;
export const GOLD_PRICE_MODES = ["derive_24k", "per_karat"] as const satisfies readonly GoldPriceMode[];
export const LIABILITY_KINDS = ["loan", "owed", "other"] as const;
export const CORPORATE_ACTION_KINDS = ["BONUS", "SPLIT", "WRITE_OFF"] as const;
export const SAVINGS_MODES = ["fixed", "percentage", "flexible"] as const satisfies readonly SavingsTargetMode[];
export const RULE_KINDS = ["fixed", "percentage", "remainder"] as const satisfies readonly RuleKind[];
export const TARGET_KINDS = ["goal", "investments", "cash"] as const satisfies readonly TargetKind[];
export const RECURRING_FREQUENCIES = ["weekly", "monthly", "yearly"] as const;
export const RECURRING_TYPES = ["INCOME", "EXPENSE"] as const satisfies readonly TxType[];
export const GOAL_TARGET_MODES = ["manual", "expense_months"] as const;

// Postgres limits behind the checks below: integer columns hold up to 2^31-1, numeric(8,6) rates stay under 100.
const INT4_MAX = 2_147_483_647;
const RATE_LIMIT = 100;

type AccountType = (typeof ACCOUNT_TYPES)[number];
type CategoryKind = (typeof CATEGORY_KINDS)[number];
type TxStatus = (typeof TX_STATUSES)[number];
type HoldingKind = (typeof HOLDING_KINDS)[number];
type GoldForm = (typeof GOLD_FORMS)[number];
type ContributionFrequency = (typeof CONTRIBUTION_FREQUENCIES)[number];
type LiabilityKind = (typeof LIABILITY_KINDS)[number];
type CorporateActionKind = (typeof CORPORATE_ACTION_KINDS)[number];
type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
type GoalTargetMode = (typeof GOAL_TARGET_MODES)[number];

// Timestamps are ISO-8601 UTC strings; user_id is deliberately absent (restore stamps the current user).
export type BackupAccount = {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  notes: string | null;
  isInvestment: boolean;
  openingBalance: Piasters;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupCategory = {
  id: string;
  name: string;
  kind: CategoryKind;
  isEssential: boolean;
  archivedAt: string | null;
  createdAt: string;
};

export type BackupTransaction = {
  id: string;
  type: TxType;
  date: string; // YYYY-MM-DD, Cairo calendar date
  amount: Piasters;
  fromAccountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
  status: TxStatus;
  fee: Piasters;
  grossAmount: Piasters | null;
  taxWithheld: Piasters | null;
  realizedPl: Piasters | null;
  holdingId: string | null;
  /** Decimal string (NUMERIC(20,6)); set on holding-linked purchases and sales, except a cloud's deposits and withdrawals. */
  quantity: string | null;
  unitPrice: string | null;
  /** Only on a LIABILITY_PAYMENT (principal) or the EXPENSE (interest) written with it. */
  liabilityId: string | null;
  replacesId: string | null;
  /** Both set (a row generated from a recurring template, for that due date) or both null. */
  recurringTemplateId: string | null;
  recurringDueDate: string | null;
  voidedAt: string | null;
  createdAt: string;
};

export type BackupBudget = {
  id: string;
  /** Null = the overall monthly budget. */
  categoryId: string | null;
  amount: Piasters;
  createdAt: string;
  updatedAt: string;
};

export type BackupRecurringTemplate = {
  id: string;
  name: string;
  type: (typeof RECURRING_TYPES)[number];
  amount: Piasters;
  categoryId: string | null;
  accountId: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate: string | null;
  autoPost: boolean;
  active: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupHolding = {
  id: string;
  accountId: string;
  kind: HoldingKind;
  name: string;
  ticker: string | null;
  notes: string | null;
  /** Gold only: 24, 21 or 18, and the form. Both null on every other kind. */
  karat: number | null;
  form: GoldForm | null;
  /** Cloud only. The contribution is used for projections, never booked. */
  startDate: string | null;
  maturityDate: string | null;
  contributionAmount: Piasters | null;
  contributionFrequency: ContributionFrequency | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupGoldPrice = {
  id: string;
  date: string;
  karat: number;
  /** Decimal string, buy-back price per gram. */
  buybackPrice: string;
  createdAt: string;
};

export type BackupRateChange = {
  id: string;
  holdingId: string;
  effectiveDate: string;
  /** Decimal: 0.2 = 20%. */
  apy: number;
  createdAt: string;
};

export type BackupCloudConfirmation = {
  id: string;
  holdingId: string;
  date: string;
  value: Piasters;
  createdAt: string;
};

export type BackupLiability = {
  id: string;
  name: string;
  kind: LiabilityKind;
  openingBalance: Piasters;
  /** Decimal, display only. */
  interestRate: number | null;
  startDate: string;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupLiabilityUpdate = {
  id: string;
  liabilityId: string;
  date: string;
  /** Signed: positive owes more. */
  delta: Piasters;
  note: string | null;
  createdAt: string;
};

export type BackupPriceUpdate = {
  id: string;
  holdingId: string;
  date: string;
  /** Decimal string, price per unit. */
  price: string;
  createdAt: string;
};

export type BackupCorporateAction = {
  id: string;
  holdingId: string;
  kind: CorporateActionKind;
  date: string;
  quantity: string | null;
  ratio: string | null;
  note: string | null;
  createdAt: string;
};

/** Expected returns the user typed; null until set. Decimals: 0.12 = 12%. */
export type BackupAssumptions = {
  stockReturn: number | null;
  goldReturn: number | null;
  savingsCloudApy: number | null;
  cashReturn: number | null;
  inflation: number | null;
  /** Yearly growth of income for the scenario calculator. */
  incomeGrowth: number | null;
};

export type BackupSettings = {
  monthStartDay: number;
  savingsTargetMode: SavingsTargetMode;
  savingsTargetAmount: Piasters | null;
  /** Decimal: 0.2 = 20%. */
  savingsTargetPercent: number | null;
  expectedMonthlyIncome: Piasters | null;
  expectedMonthlySpending: Piasters | null;
  staleDaysHoldings: number;
  goldPriceMode: GoldPriceMode;
  staleDaysGold: number;
  staleDaysClouds: number;
  /** Decimals: 0.8 = a budget warns at 80% spent, alerts at 1 = 100%. */
  budgetWarnAt: number;
  budgetAlertAt: number;
  /** Target share of each asset class, decimals: all four null (none set) or all four set, totalling 1. */
  targetStocks: number | null;
  targetGold: number | null;
  targetClouds: number | null;
  targetCash: number | null;
  /** A spending change is an insight only if it reaches both: this share (0.15 = 15%) and this amount in piasters. */
  insightMinPercent: number;
  insightMinAmount: Piasters;
  remindReview: boolean;
  remindRecurring: boolean;
  remindStale: boolean;
  remindGoal: boolean;
  remindBudget: boolean;
  remindSavings: boolean;
};

export type BackupGoal = {
  id: string;
  name: string;
  targetAmount: Piasters;
  /** expense_months: the target is targetMonths x average monthly essential spending; targetAmount is the fallback. */
  targetMode: GoalTargetMode;
  targetMonths: number | null;
  targetDate: string;
  startDate: string;
  priority: number;
  plannedMonthly: Piasters | null;
  /** Decimal: 0.12 = 12%. */
  expectedReturnOverride: number | null;
  manualCurrent: Piasters | null;
  notes: string | null;
  color: string | null;
  icon: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Either a cash allocation (accountId and amount) or a share of a holding (holdingId and percent), never both. */
export type BackupGoalAllocation = {
  id: string;
  goalId: string;
  accountId: string | null;
  amount: Piasters | null;
  holdingId: string | null;
  /** Decimal: 0.25 = 25%, above 0 and up to 1. */
  percent: number | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupGoalAllocationEvent = {
  id: string;
  goalId: string;
  accountId: string | null;
  holdingId: string | null;
  /** Signed share change of a holding event; `delta` stays the EGP value of the change. */
  percentDelta: number | null;
  delta: Piasters;
  date: string;
  note: string | null;
  createdAt: string;
};

export type BackupAllocationRule = {
  id: string;
  kind: RuleKind;
  targetKind: TargetKind;
  goalId: string | null;
  amount: Piasters | null;
  /** Decimal: 0.25 = 25%. */
  percent: number | null;
  createdAt: string;
};

export type BackupAllocationOverride = {
  id: string;
  ruleId: string;
  month: string; // YYYY-MM, start month of the financial month
  amount: Piasters;
  createdAt: string;
};

export type Backup = {
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  settings: BackupSettings;
  accounts: BackupAccount[];
  categories: BackupCategory[];
  transactions: BackupTransaction[];
  goals: BackupGoal[];
  goalAllocations: BackupGoalAllocation[];
  goalAllocationEvents: BackupGoalAllocationEvent[];
  allocationRules: BackupAllocationRule[];
  allocationOverrides: BackupAllocationOverride[];
  holdings: BackupHolding[];
  priceUpdates: BackupPriceUpdate[];
  corporateActions: BackupCorporateAction[];
  goldPrices: BackupGoldPrice[];
  rateHistory: BackupRateChange[];
  cloudConfirmations: BackupCloudConfirmation[];
  liabilities: BackupLiability[];
  liabilityUpdates: BackupLiabilityUpdate[];
  budgets: BackupBudget[];
  recurringTemplates: BackupRecurringTemplate[];
  assumptions: BackupAssumptions;
};

// Database rows carry Date timestamps, and numeric rates may arrive as strings from the driver.
type Dated<T, K extends keyof T> = Omit<T, K> & { [P in K]: null extends T[P] ? Date | null : Date };
type Rated<T, K extends keyof T> = Omit<T, K> & { [P in K]: number | string | null };
type AccountRow = Dated<BackupAccount, "archivedAt" | "createdAt" | "updatedAt">;
type CategoryRow = Dated<BackupCategory, "archivedAt" | "createdAt">;
type TransactionRow = Dated<BackupTransaction, "voidedAt" | "createdAt">;
type SettingsRow = Rated<
  BackupSettings,
  "savingsTargetPercent" | "budgetWarnAt" | "budgetAlertAt" | "targetStocks" | "targetGold" | "targetClouds" | "targetCash" | "insightMinPercent"
>;
type GoalRow = Rated<Dated<BackupGoal, "archivedAt" | "createdAt" | "updatedAt">, "expectedReturnOverride">;
type GoalAllocationRow = Rated<Dated<BackupGoalAllocation, "createdAt" | "updatedAt">, "percent">;
type GoalAllocationEventRow = Rated<Dated<BackupGoalAllocationEvent, "createdAt">, "percentDelta">;
type AllocationRuleRow = Rated<Dated<BackupAllocationRule, "createdAt">, "percent">;
type AllocationOverrideRow = Dated<BackupAllocationOverride, "createdAt">;
type BudgetRow = Dated<BackupBudget, "createdAt" | "updatedAt">;
// The column is the whole transaction_type enum; a CHECK limits it to INCOME and EXPENSE.
type RecurringTemplateRow = Dated<Omit<BackupRecurringTemplate, "type"> & { type: TxType }, "createdAt" | "updatedAt">;
type HoldingRow = Dated<BackupHolding, "archivedAt" | "createdAt" | "updatedAt">;
type GoldPriceRow = Dated<BackupGoldPrice, "createdAt">;
type RateChangeRow = Rated<Dated<BackupRateChange, "createdAt">, "apy">;
type CloudConfirmationRow = Dated<BackupCloudConfirmation, "createdAt">;
type LiabilityRow = Rated<Dated<BackupLiability, "archivedAt" | "createdAt" | "updatedAt">, "interestRate">;
type LiabilityUpdateRow = Dated<BackupLiabilityUpdate, "createdAt">;
type PriceUpdateRow = Dated<BackupPriceUpdate, "createdAt">;
type CorporateActionRow = Dated<BackupCorporateAction, "createdAt">;
type AssumptionsRow = { [K in keyof BackupAssumptions]: number | string | null };

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const numOrNull = (v: number | string | null) => (v === null ? null : Number(v));

/** What serializeBackup takes: one list per table. The export route's loader must return all of it. */
export type BackupRows = {
  settings: SettingsRow;
  accounts: AccountRow[];
  categories: CategoryRow[];
  transactions: TransactionRow[];
  goals: GoalRow[];
  goalAllocations: GoalAllocationRow[];
  goalAllocationEvents: GoalAllocationEventRow[];
  allocationRules: AllocationRuleRow[];
  allocationOverrides: AllocationOverrideRow[];
  holdings: HoldingRow[];
  priceUpdates: PriceUpdateRow[];
  corporateActions: CorporateActionRow[];
  goldPrices: GoldPriceRow[];
  rateHistory: RateChangeRow[];
  cloudConfirmations: CloudConfirmationRow[];
  liabilities: LiabilityRow[];
  liabilityUpdates: LiabilityUpdateRow[];
  budgets: BudgetRow[];
  recurringTemplates: RecurringTemplateRow[];
  assumptions: AssumptionsRow;
};

/** Database rows (Date timestamps, with user_id) to the backup shape. Fields are copied by name, so user_id never leaks in. */
export function serializeBackup(rows: BackupRows, exportedAt: Date = new Date()): Backup {
  return {
    version: BACKUP_VERSION,
    exportedAt: iso(exportedAt),
    settings: {
      monthStartDay: rows.settings.monthStartDay,
      savingsTargetMode: rows.settings.savingsTargetMode,
      savingsTargetAmount: rows.settings.savingsTargetAmount,
      savingsTargetPercent: numOrNull(rows.settings.savingsTargetPercent),
      expectedMonthlyIncome: rows.settings.expectedMonthlyIncome,
      expectedMonthlySpending: rows.settings.expectedMonthlySpending,
      staleDaysHoldings: rows.settings.staleDaysHoldings,
      goldPriceMode: rows.settings.goldPriceMode,
      staleDaysGold: rows.settings.staleDaysGold,
      staleDaysClouds: rows.settings.staleDaysClouds,
      budgetWarnAt: Number(rows.settings.budgetWarnAt),
      budgetAlertAt: Number(rows.settings.budgetAlertAt),
      targetStocks: numOrNull(rows.settings.targetStocks),
      targetGold: numOrNull(rows.settings.targetGold),
      targetClouds: numOrNull(rows.settings.targetClouds),
      targetCash: numOrNull(rows.settings.targetCash),
      insightMinPercent: Number(rows.settings.insightMinPercent),
      insightMinAmount: rows.settings.insightMinAmount,
      remindReview: rows.settings.remindReview,
      remindRecurring: rows.settings.remindRecurring,
      remindStale: rows.settings.remindStale,
      remindGoal: rows.settings.remindGoal,
      remindBudget: rows.settings.remindBudget,
      remindSavings: rows.settings.remindSavings,
    },
    accounts: rows.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution,
      notes: a.notes,
      isInvestment: a.isInvestment,
      openingBalance: a.openingBalance,
      archivedAt: isoOrNull(a.archivedAt),
      createdAt: iso(a.createdAt),
      updatedAt: iso(a.updatedAt),
    })),
    categories: rows.categories.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      isEssential: c.isEssential,
      archivedAt: isoOrNull(c.archivedAt),
      createdAt: iso(c.createdAt),
    })),
    transactions: rows.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      date: t.date,
      amount: t.amount,
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      categoryId: t.categoryId,
      note: t.note,
      status: t.status,
      fee: t.fee,
      grossAmount: t.grossAmount,
      taxWithheld: t.taxWithheld,
      realizedPl: t.realizedPl,
      holdingId: t.holdingId,
      quantity: t.quantity,
      unitPrice: t.unitPrice,
      liabilityId: t.liabilityId,
      replacesId: t.replacesId,
      recurringTemplateId: t.recurringTemplateId,
      recurringDueDate: t.recurringDueDate,
      voidedAt: isoOrNull(t.voidedAt),
      createdAt: iso(t.createdAt),
    })),
    goals: rows.goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount,
      targetMode: g.targetMode,
      targetMonths: g.targetMonths,
      targetDate: g.targetDate,
      startDate: g.startDate,
      priority: g.priority,
      plannedMonthly: g.plannedMonthly,
      expectedReturnOverride: numOrNull(g.expectedReturnOverride),
      manualCurrent: g.manualCurrent,
      notes: g.notes,
      color: g.color,
      icon: g.icon,
      archivedAt: isoOrNull(g.archivedAt),
      createdAt: iso(g.createdAt),
      updatedAt: iso(g.updatedAt),
    })),
    goalAllocations: rows.goalAllocations.map((a) => ({
      id: a.id,
      goalId: a.goalId,
      accountId: a.accountId,
      amount: a.amount,
      holdingId: a.holdingId,
      percent: numOrNull(a.percent),
      createdAt: iso(a.createdAt),
      updatedAt: iso(a.updatedAt),
    })),
    goalAllocationEvents: rows.goalAllocationEvents.map((e) => ({
      id: e.id,
      goalId: e.goalId,
      accountId: e.accountId,
      holdingId: e.holdingId,
      percentDelta: numOrNull(e.percentDelta),
      delta: e.delta,
      date: e.date,
      note: e.note,
      createdAt: iso(e.createdAt),
    })),
    allocationRules: rows.allocationRules.map((r) => ({
      id: r.id,
      kind: r.kind,
      targetKind: r.targetKind,
      goalId: r.goalId,
      amount: r.amount,
      percent: numOrNull(r.percent),
      createdAt: iso(r.createdAt),
    })),
    allocationOverrides: rows.allocationOverrides.map((o) => ({
      id: o.id,
      ruleId: o.ruleId,
      month: o.month,
      amount: o.amount,
      createdAt: iso(o.createdAt),
    })),
    holdings: rows.holdings.map((h) => ({
      id: h.id,
      accountId: h.accountId,
      kind: h.kind,
      name: h.name,
      ticker: h.ticker,
      notes: h.notes,
      karat: h.karat,
      form: h.form,
      startDate: h.startDate,
      maturityDate: h.maturityDate,
      contributionAmount: h.contributionAmount,
      contributionFrequency: h.contributionFrequency,
      archivedAt: isoOrNull(h.archivedAt),
      createdAt: iso(h.createdAt),
      updatedAt: iso(h.updatedAt),
    })),
    priceUpdates: rows.priceUpdates.map((p) => ({
      id: p.id,
      holdingId: p.holdingId,
      date: p.date,
      price: p.price,
      createdAt: iso(p.createdAt),
    })),
    corporateActions: rows.corporateActions.map((c) => ({
      id: c.id,
      holdingId: c.holdingId,
      kind: c.kind,
      date: c.date,
      quantity: c.quantity,
      ratio: c.ratio,
      note: c.note,
      createdAt: iso(c.createdAt),
    })),
    goldPrices: rows.goldPrices.map((p) => ({
      id: p.id,
      date: p.date,
      karat: p.karat,
      buybackPrice: p.buybackPrice,
      createdAt: iso(p.createdAt),
    })),
    rateHistory: rows.rateHistory.map((r) => ({
      id: r.id,
      holdingId: r.holdingId,
      effectiveDate: r.effectiveDate,
      apy: Number(r.apy),
      createdAt: iso(r.createdAt),
    })),
    cloudConfirmations: rows.cloudConfirmations.map((c) => ({
      id: c.id,
      holdingId: c.holdingId,
      date: c.date,
      value: c.value,
      createdAt: iso(c.createdAt),
    })),
    liabilities: rows.liabilities.map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      openingBalance: l.openingBalance,
      interestRate: numOrNull(l.interestRate),
      startDate: l.startDate,
      notes: l.notes,
      archivedAt: isoOrNull(l.archivedAt),
      createdAt: iso(l.createdAt),
      updatedAt: iso(l.updatedAt),
    })),
    liabilityUpdates: rows.liabilityUpdates.map((u) => ({
      id: u.id,
      liabilityId: u.liabilityId,
      date: u.date,
      delta: u.delta,
      note: u.note,
      createdAt: iso(u.createdAt),
    })),
    budgets: rows.budgets.map((b) => ({
      id: b.id,
      categoryId: b.categoryId,
      amount: b.amount,
      createdAt: iso(b.createdAt),
      updatedAt: iso(b.updatedAt),
    })),
    recurringTemplates: rows.recurringTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type as BackupRecurringTemplate["type"],
      amount: t.amount,
      categoryId: t.categoryId,
      accountId: t.accountId,
      frequency: t.frequency,
      startDate: t.startDate,
      endDate: t.endDate,
      autoPost: t.autoPost,
      active: t.active,
      note: t.note,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    })),
    assumptions: {
      stockReturn: numOrNull(rows.assumptions.stockReturn),
      goldReturn: numOrNull(rows.assumptions.goldReturn),
      savingsCloudApy: numOrNull(rows.assumptions.savingsCloudApy),
      cashReturn: numOrNull(rows.assumptions.cashReturn),
      inflation: numOrNull(rows.assumptions.inflation),
      incomeGrowth: numOrNull(rows.assumptions.incomeGrowth),
    },
  };
}

type EventTx = Pick<
  BackupTransaction,
  "type" | "date" | "amount" | "status" | "fee" | "grossAmount" | "taxWithheld" | "holdingId" | "quantity" | "unitPrice"
> & { createdAt: Date | string };
type EventAction = Pick<BackupCorporateAction, "holdingId" | "kind" | "date" | "quantity" | "ratio"> & {
  createdAt: Date | string;
};
export type LedgerEvent = HoldingEvent & { holdingId: string };

/**
 * Holding-linked ledger rows plus corporate actions as engine events. Pending and void rows are skipped
 * (rule E), and so are cloud deposits and withdrawals. createdAt is normalised to ISO so the engine's text ordering is right for any input.
 */
export function toHoldingEvents(txs: EventTx[], actions: EventAction[]): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const t of txs) {
    // A cloud's deposits and withdrawals have no quantity; clouds.ts values them, they are not replayed as units.
    if (t.status !== "posted" || !t.holdingId || (t.quantity === null && t.type !== "DIVIDEND")) continue;
    const at = { holdingId: t.holdingId, date: t.date, createdAt: new Date(t.createdAt).toISOString() };
    const tax = t.taxWithheld ?? 0;
    if (t.type === "INVESTMENT_PURCHASE") {
      events.push({ ...at, type: "purchase", quantity: t.quantity!, price: t.unitPrice!, fee: t.fee });
    } else if (t.type === "INVESTMENT_SALE") {
      events.push({ ...at, type: "sale", quantity: t.quantity!, price: t.unitPrice!, fee: t.fee, tax });
    } else if (t.type === "DIVIDEND") {
      events.push({ ...at, type: "dividend", gross: t.grossAmount ?? t.amount + tax, tax });
    }
  }
  for (const a of actions) {
    const at = { holdingId: a.holdingId, date: a.date, createdAt: new Date(a.createdAt).toISOString() };
    if (a.kind === "BONUS") events.push({ ...at, type: "bonus", quantity: a.quantity! });
    else if (a.kind === "SPLIT") events.push({ ...at, type: "split", ratio: a.ratio! });
    else events.push({ ...at, type: "writeOff" });
  }
  return events;
}

export function eventsByHolding(events: LedgerEvent[]): Map<string, HoldingEvent[]> {
  const byHolding = new Map<string, HoldingEvent[]>();
  for (const e of events) {
    const list = byHolding.get(e.holdingId);
    if (list) list.push(e);
    else byHolding.set(e.holdingId, [e]);
  }
  return byHolding;
}

// ---- parsing ----

type Obj = Record<string, unknown>;

class BackupError extends Error {}

function bad(where: string, message: string): never {
  throw new BackupError(`${where}: ${message}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function entry(v: unknown, where: string): Obj {
  if (!isObj(v)) bad(where, "must be an object");
  return v as Obj;
}

function list(root: Obj, key: string): unknown[] {
  const v = root[key];
  if (!Array.isArray(v)) bad(key, "must be a list");
  return v as unknown[];
}

// Postgres text cannot hold a NUL character, so reject it here rather than fail mid-restore.
function text(o: Obj, k: string, w: string): string {
  const v = o[k];
  if (typeof v !== "string" || v.includes("\0")) bad(`${w}.${k}`, "must be text");
  return v as string;
}

function name(o: Obj, k: string, w: string): string {
  const v = text(o, k, w);
  if (v.trim() === "") bad(`${w}.${k}`, "must not be empty");
  return v;
}

function flag(o: Obj, k: string, w: string): boolean {
  if (typeof o[k] !== "boolean") bad(`${w}.${k}`, "must be true or false");
  return o[k] as boolean;
}

function whole(o: Obj, k: string, w: string, what = "a whole number of piasters"): number {
  if (!Number.isSafeInteger(o[k])) bad(`${w}.${k}`, `must be ${what}`);
  return o[k] as number;
}

/** A decimal rate like 0.12; numeric(8,6) holds anything under 100 in size. */
function rate(o: Obj, k: string, w: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) >= RATE_LIMIT) {
    bad(`${w}.${k}`, `must be a decimal rate such as 0.12 for 12% (under ${RATE_LIMIT} in size)`);
  }
  return v as number;
}

function oneOf<T extends string>(o: Obj, k: string, w: string, allowed: readonly T[]): T {
  if (!allowed.includes(o[k] as T)) bad(`${w}.${k}`, `must be one of ${allowed.join(", ")}`);
  return o[k] as T;
}

function uuid(o: Obj, k: string, w: string): string {
  const v = o[k];
  if (typeof v !== "string" || !UUID.test(v)) bad(`${w}.${k}`, "must be a lowercase uuid");
  return v as string;
}

function stamp(o: Obj, k: string, w: string): string {
  const v = o[k];
  if (typeof v !== "string" || !STAMP.test(v) || Number.isNaN(Date.parse(v))) {
    bad(`${w}.${k}`, "must be a UTC timestamp like 2026-01-31T10:00:00.000Z");
  }
  return v as string;
}

/** A real YYYY-MM-DD calendar date; 2026-02-30 is rejected like Postgres would. */
function day(o: Obj, k: string, w: string): string {
  const v = o[k];
  const ok = typeof v === "string" && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!ok) bad(`${w}.${k}`, "must be a real date like 2026-01-31");
  return v as string;
}

const orNull =
  <T>(read: (o: Obj, k: string, w: string) => T) =>
  (o: Obj, k: string, w: string): T | null =>
    o[k] === null ? null : read(o, k, w);

// NUMERIC(20,6) as a string: 14 whole digits, up to 6 decimals, never negative, never exponent notation.
const DECIMAL6 = /^\d{1,14}(\.\d{1,6})?$/;
const isZeroDecimal = (d: string) => !/[1-9]/.test(d);

function decimal(o: Obj, k: string, w: string): string {
  const v = o[k];
  if (typeof v !== "string" || !DECIMAL6.test(v)) {
    bad(`${w}.${k}`, 'must be a decimal string such as "12.5" (at most 14 whole digits and 6 decimals, not negative)');
  }
  return v as string;
}

/** A share or share change: a decimal rate that fits numeric(8,6) exactly, so share sums can be added as whole millionths. */
function share(o: Obj, k: string, w: string): number {
  const v = rate(o, k, w);
  if (Math.abs(v * 1_000_000 - Math.round(v * 1_000_000)) > 1e-4) bad(`${w}.${k}`, "must have at most 6 decimals");
  return v;
}

const micro = (v: number) => Math.round(v * 1_000_000);

/** A decimal that fits numeric(4,3) exactly (user_settings.budget_*_at). */
function thousandths(o: Obj, k: string, w: string): number {
  const v = rate(o, k, w);
  if (Math.abs(v * 1000 - Math.round(v * 1000)) > 1e-6) bad(`${w}.${k}`, "must have at most 3 decimals");
  return v;
}

/** A decimal with at most `places` decimals, so it fits its numeric column exactly. */
function decimals(o: Obj, k: string, w: string, places: number): number {
  const v = rate(o, k, w);
  if (Math.abs(v * 10 ** places - Math.round(v * 10 ** places)) > 1e-6) bad(`${w}.${k}`, `must have at most ${places} decimals`);
  return v;
}

const textOrNull = orNull(text);
const targetOrNull = orNull((o: Obj, k: string, w: string) => decimals(o, k, w, 5));
const decimalOrNull = orNull(decimal);
const wholeOrNull = orNull((o: Obj, k: string, w: string) => whole(o, k, w));
const rateOrNull = orNull(rate);
const shareOrNull = orNull(share);
const dayOrNull = orNull(day);
const formOrNull = orNull((o: Obj, k: string, w: string) => oneOf(o, k, w, GOLD_FORMS));
const frequencyOrNull = orNull((o: Obj, k: string, w: string) => oneOf(o, k, w, CONTRIBUTION_FREQUENCIES));const uuidOrNull = orNull(uuid);
const stampOrNull = orNull(stamp);

function unique(values: string[], where: string): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) bad(where, `appears twice: ${v}`);
    seen.add(v);
  }
}

// Same rules as transactions_accounts_by_type_check in db/schema.ts.
const TO_ONLY: readonly TxType[] = ["INCOME", "DIVIDEND", "INTEREST", "INVESTMENT_SALE", "ADJUSTMENT"];
const FROM_ONLY: readonly TxType[] = ["EXPENSE", "INVESTMENT_PURCHASE", "LIABILITY_PAYMENT"];
const HOLDING_TYPES: readonly TxType[] = ["INVESTMENT_PURCHASE", "INVESTMENT_SALE", "DIVIDEND"];

function parseTransaction(raw: unknown, i: number, version: number): BackupTransaction {
  const w = `transactions[${i}]`;
  const o = entry(raw, w);
  const t: BackupTransaction = {
    id: uuid(o, "id", w),
    type: oneOf(o, "type", w, TX_TYPES),
    date: day(o, "date", w),
    amount: whole(o, "amount", w),
    fromAccountId: uuidOrNull(o, "fromAccountId", w),
    toAccountId: uuidOrNull(o, "toAccountId", w),
    categoryId: uuidOrNull(o, "categoryId", w),
    note: textOrNull(o, "note", w),
    status: oneOf(o, "status", w, TX_STATUSES),
    fee: whole(o, "fee", w),
    grossAmount: wholeOrNull(o, "grossAmount", w),
    taxWithheld: wholeOrNull(o, "taxWithheld", w),
    realizedPl: wholeOrNull(o, "realizedPl", w),
    holdingId: version < 3 ? null : uuidOrNull(o, "holdingId", w),
    quantity: version < 3 ? null : decimalOrNull(o, "quantity", w),
    unitPrice: version < 3 ? null : decimalOrNull(o, "unitPrice", w),
    liabilityId: version < 4 ? null : uuidOrNull(o, "liabilityId", w),
    replacesId: uuidOrNull(o, "replacesId", w),
    recurringTemplateId: version < 5 ? null : uuidOrNull(o, "recurringTemplateId", w),
    recurringDueDate: version < 5 ? null : dayOrNull(o, "recurringDueDate", w),
    voidedAt: stampOrNull(o, "voidedAt", w),
    createdAt: stamp(o, "createdAt", w),
  };

  // Same rule as transactions_recurring_check in db/schema.ts.
  if ((t.recurringTemplateId === null) !== (t.recurringDueDate === null)) {
    bad(w, "recurringTemplateId and recurringDueDate are set together or not at all");
  }
  if (t.amount === 0 || (t.type !== "ADJUSTMENT" && t.amount < 0)) {
    bad(`${w}.amount`, "must be positive (only ADJUSTMENT may be negative) and never zero");
  }
  if (t.fee < 0 || (t.taxWithheld ?? 0) < 0) bad(w, "fee and taxWithheld must not be negative");

  const { fromAccountId: from, toAccountId: to } = t;
  if (TO_ONLY.includes(t.type)) {
    if (!to || from) bad(w, `${t.type} needs toAccountId and no fromAccountId`);
  } else if (FROM_ONLY.includes(t.type)) {
    if (!from || to) bad(w, `${t.type} needs fromAccountId and no toAccountId`);
  } else if (!from || !to || from === to) {
    bad(w, "TRANSFER needs two different accounts (fromAccountId and toAccountId)");
  }

  // Same rules as transactions_holding_type_check and transactions_quantity_price_check in db/schema.ts.
  if (t.holdingId !== null && !HOLDING_TYPES.includes(t.type)) {
    bad(`${w}.holdingId`, `only INVESTMENT_PURCHASE, INVESTMENT_SALE and DIVIDEND may belong to a holding, not ${t.type}`);
  }
  if (t.liabilityId !== null && t.type !== "LIABILITY_PAYMENT" && t.type !== "EXPENSE") {
    bad(`${w}.liabilityId`, `only a LIABILITY_PAYMENT or an EXPENSE may belong to a liability, not ${t.type}`);
  }
  const trade = (t.type === "INVESTMENT_PURCHASE" || t.type === "INVESTMENT_SALE") && t.holdingId !== null;
  if (trade) {
    // Both set (stocks, funds, gold) or both null (a cloud's deposits and withdrawals); which one is right
    // depends on the holding's kind, so build() checks that once the holdings are known.
    if ((t.quantity === null) !== (t.unitPrice === null) || (t.quantity !== null && isZeroDecimal(t.quantity))) {
      bad(w, `${t.type} on a holding needs a quantity above zero and a unitPrice (a cloud deposit or withdrawal has neither)`);
    }
  } else if (t.quantity !== null || t.unitPrice !== null) {
    bad(w, "quantity and unitPrice are only allowed on a purchase or sale that belongs to a holding");
  }
  return t;
}

/** Length of each transaction's replaces_id chain (0 = replaces nothing); null if a chain loops back on itself. */
function replaceDepths(txs: { id: string; replacesId: string | null }[]): Map<string, number> | null {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  for (const start of txs) {
    const chain: string[] = [];
    let cur = start as (typeof txs)[number] | undefined;
    while (cur && !depth.has(cur.id)) {
      if (chain.includes(cur.id)) return null;
      chain.push(cur.id);
      cur = cur.replacesId ? byId.get(cur.replacesId) : undefined;
    }
    let d = cur ? depth.get(cur.id)! : -1;
    for (let i = chain.length - 1; i >= 0; i--) depth.set(chain[i], ++d);
  }
  return depth;
}

/** Transactions ordered so every replaces_id target comes before the row that points at it. */
export function insertOrder<T extends { id: string; replacesId: string | null }>(txs: T[]): T[] {
  const depth = replaceDepths(txs);
  if (!depth) throw new Error("replaces_id chain loops; parseBackup rejects such files");
  return [...txs].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!);
}

function staleDaysField(o: Obj, k: string): number {
  // Same rule as the user_settings_stale_days_*_range checks in db/schema.ts.
  const days = whole(o, k, "settings", "a whole number of days from 1 to 365");
  if (days < 1 || days > 365) bad(`settings.${k}`, "must be a whole number of days from 1 to 365");
  return days;
}

const V6_SETTINGS_DEFAULTS = {
  targetStocks: null,
  targetGold: null,
  targetClouds: null,
  targetCash: null,
  insightMinPercent: DEFAULT_NOTABLE_PERCENT,
  insightMinAmount: DEFAULT_NOTABLE_AMOUNT,
  remindReview: true,
  remindRecurring: true,
  remindStale: true,
  remindGoal: true,
  remindBudget: true,
  remindSavings: true,
} as const;

// Same rules as user_settings_target_mix_check and user_settings_insight_thresholds_check in db/schema.ts.
function parseV6Settings(o: Obj): Pick<BackupSettings, keyof typeof V6_SETTINGS_DEFAULTS> {
  const targets = {
    targetStocks: targetOrNull(o, "targetStocks", "settings"),
    targetGold: targetOrNull(o, "targetGold", "settings"),
    targetClouds: targetOrNull(o, "targetClouds", "settings"),
    targetCash: targetOrNull(o, "targetCash", "settings"),
  };
  const check = validateTargets({ stocks: targets.targetStocks, gold: targets.targetGold, clouds: targets.targetClouds, cash: targets.targetCash });
  if (!check.ok) bad("settings", check.error);
  const insightMinPercent = decimals(o, "insightMinPercent", "settings", 4);
  const insightMinAmount = whole(o, "insightMinAmount", "settings");
  if (insightMinPercent < 0 || insightMinPercent >= 10 || insightMinAmount < 0) {
    bad("settings", "insightMinPercent must be between 0 and 10 (1000%) and insightMinAmount must not be negative");
  }
  return {
    ...targets,
    insightMinPercent,
    insightMinAmount,
    remindReview: flag(o, "remindReview", "settings"),
    remindRecurring: flag(o, "remindRecurring", "settings"),
    remindStale: flag(o, "remindStale", "settings"),
    remindGoal: flag(o, "remindGoal", "settings"),
    remindBudget: flag(o, "remindBudget", "settings"),
    remindSavings: flag(o, "remindSavings", "settings"),
  };
}

function parseSettings(raw: unknown, version: number): BackupSettings {
  const o = entry(raw, "settings");
  const monthStartDay = whole(o, "monthStartDay", "settings", "a whole number from 1 to 28");
  if (monthStartDay < 1 || monthStartDay > 28) bad("settings.monthStartDay", "must be a whole number from 1 to 28");
  if (version < 2) {
    return {
      monthStartDay,
      savingsTargetMode: "flexible",
      savingsTargetAmount: null,
      savingsTargetPercent: null,
      expectedMonthlyIncome: null,
      expectedMonthlySpending: null,
      staleDaysHoldings: DEFAULT_STALE_DAYS,
      goldPriceMode: "derive_24k",
      staleDaysGold: DEFAULT_STALE_DAYS_GOLD,
      staleDaysClouds: DEFAULT_STALE_DAYS_CLOUDS,
      budgetWarnAt: DEFAULT_BUDGET_WARN_AT,
      budgetAlertAt: DEFAULT_BUDGET_ALERT_AT,
      ...V6_SETTINGS_DEFAULTS,
    };
  }
  // Same rule as user_settings_stale_days_holdings_range in db/schema.ts.
  const staleDaysHoldings = version < 3 ? DEFAULT_STALE_DAYS : staleDaysField(o, "staleDaysHoldings");
  const budgetWarnAt = version < 5 ? DEFAULT_BUDGET_WARN_AT : thousandths(o, "budgetWarnAt", "settings");
  const budgetAlertAt = version < 5 ? DEFAULT_BUDGET_ALERT_AT : thousandths(o, "budgetAlertAt", "settings");
  // Same rule as user_settings_budget_thresholds_check in db/schema.ts.
  if (!(budgetWarnAt > 0 && budgetWarnAt <= budgetAlertAt && budgetAlertAt <= 2)) {
    bad("settings", "budgetWarnAt must be above 0, no higher than budgetAlertAt, which must be 2 (200%) or less");
  }
  return {
    monthStartDay,
    savingsTargetMode: oneOf(o, "savingsTargetMode", "settings", SAVINGS_MODES),
    savingsTargetAmount: wholeOrNull(o, "savingsTargetAmount", "settings"),
    savingsTargetPercent: rateOrNull(o, "savingsTargetPercent", "settings"),
    expectedMonthlyIncome: wholeOrNull(o, "expectedMonthlyIncome", "settings"),
    expectedMonthlySpending: wholeOrNull(o, "expectedMonthlySpending", "settings"),
    staleDaysHoldings,
    goldPriceMode: version < 4 ? "derive_24k" : oneOf(o, "goldPriceMode", "settings", GOLD_PRICE_MODES),
    staleDaysGold: version < 4 ? DEFAULT_STALE_DAYS_GOLD : staleDaysField(o, "staleDaysGold"),
    staleDaysClouds: version < 4 ? DEFAULT_STALE_DAYS_CLOUDS : staleDaysField(o, "staleDaysClouds"),
    budgetWarnAt,
    budgetAlertAt,
    ...(version < 6 ? V6_SETTINGS_DEFAULTS : parseV6Settings(o)),
  };
}

function parseAssumptions(raw: unknown, version: number): BackupAssumptions {
  if (version < 3) return { stockReturn: null, goldReturn: null, savingsCloudApy: null, cashReturn: null, inflation: null, incomeGrowth: null };
  const o = entry(raw, "assumptions");
  return {
    stockReturn: rateOrNull(o, "stockReturn", "assumptions"),
    goldReturn: rateOrNull(o, "goldReturn", "assumptions"),
    savingsCloudApy: rateOrNull(o, "savingsCloudApy", "assumptions"),
    cashReturn: rateOrNull(o, "cashReturn", "assumptions"),
    inflation: rateOrNull(o, "inflation", "assumptions"),
    incomeGrowth: version < 6 ? null : rateOrNull(o, "incomeGrowth", "assumptions"),
  };
}

// Same rules as holdings_gold_fields_check, holdings_cloud_fields_check and holdings_cloud_values_check in db/schema.ts.
function parseHolding(raw: unknown, i: number, version: number): BackupHolding {
  const w = `holdings[${i}]`;
  const o = entry(raw, w);
  const v4 = version >= 4;
  const h: BackupHolding = {
    id: uuid(o, "id", w),
    accountId: uuid(o, "accountId", w),
    kind: oneOf(o, "kind", w, HOLDING_KINDS),
    name: name(o, "name", w),
    ticker: textOrNull(o, "ticker", w),
    notes: textOrNull(o, "notes", w),
    karat: v4 ? wholeOrNull(o, "karat", w) : null,
    form: v4 ? formOrNull(o, "form", w) : null,
    startDate: v4 ? dayOrNull(o, "startDate", w) : null,
    maturityDate: v4 ? dayOrNull(o, "maturityDate", w) : null,
    contributionAmount: v4 ? wholeOrNull(o, "contributionAmount", w) : null,
    contributionFrequency: v4 ? frequencyOrNull(o, "contributionFrequency", w) : null,
    archivedAt: stampOrNull(o, "archivedAt", w),
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
  if (h.kind === "gold") {
    if (h.karat === null || !(KARATS as readonly number[]).includes(h.karat) || h.form === null) {
      bad(w, "a gold holding needs a karat of 24, 21 or 18 and a form");
    }
  } else if (h.karat !== null || h.form !== null) {
    bad(w, "only a gold holding has a karat and a form");
  }
  if (h.kind !== "cloud" && (h.startDate || h.maturityDate || h.contributionAmount !== null || h.contributionFrequency)) {
    bad(w, "only a cloud has a start date, a maturity date or a contribution");
  }
  if (h.startDate !== null && h.maturityDate !== null && h.maturityDate < h.startDate) {
    bad(`${w}.maturityDate`, "must not be before the start date");
  }
  if ((h.contributionAmount === null) !== (h.contributionFrequency === null)) {
    bad(w, "contributionAmount and contributionFrequency are set together or not at all");
  }
  if (h.contributionAmount !== null && h.contributionAmount <= 0) bad(`${w}.contributionAmount`, "must be above zero");
  return h;
}

// gold_prices_karat_check; decimal() already refuses a negative price (gold_prices_price_check).
function parseGoldPrice(raw: unknown, i: number): BackupGoldPrice {
  const w = `goldPrices[${i}]`;
  const o = entry(raw, w);
  const p: BackupGoldPrice = {
    id: uuid(o, "id", w),
    date: day(o, "date", w),
    karat: whole(o, "karat", w, "24, 21 or 18"),
    buybackPrice: decimal(o, "buybackPrice", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (!(KARATS as readonly number[]).includes(p.karat)) bad(`${w}.karat`, "must be 24, 21 or 18");
  return p;
}

// rate_history_apy_check.
function parseRateChange(raw: unknown, i: number): BackupRateChange {
  const w = `rateHistory[${i}]`;
  const o = entry(raw, w);
  const r: BackupRateChange = {
    id: uuid(o, "id", w),
    holdingId: uuid(o, "holdingId", w),
    effectiveDate: day(o, "effectiveDate", w),
    apy: rate(o, "apy", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (r.apy <= -1) bad(`${w}.apy`, "must be above -1 (-100%)");
  return r;
}

// cloud_confirmations_value_check.
function parseCloudConfirmation(raw: unknown, i: number): BackupCloudConfirmation {
  const w = `cloudConfirmations[${i}]`;
  const o = entry(raw, w);
  const c: BackupCloudConfirmation = {
    id: uuid(o, "id", w),
    holdingId: uuid(o, "holdingId", w),
    date: day(o, "date", w),
    value: whole(o, "value", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (c.value < 0) bad(`${w}.value`, "must not be negative");
  return c;
}

// liabilities_opening_balance_check, liabilities_interest_rate_check.
function parseLiability(raw: unknown, i: number): BackupLiability {
  const w = `liabilities[${i}]`;
  const o = entry(raw, w);
  const l: BackupLiability = {
    id: uuid(o, "id", w),
    name: name(o, "name", w),
    kind: oneOf(o, "kind", w, LIABILITY_KINDS),
    openingBalance: whole(o, "openingBalance", w),
    interestRate: rateOrNull(o, "interestRate", w),
    startDate: day(o, "startDate", w),
    notes: textOrNull(o, "notes", w),
    archivedAt: stampOrNull(o, "archivedAt", w),
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
  if (l.openingBalance <= 0) bad(`${w}.openingBalance`, "must be above zero");
  if (l.interestRate !== null && l.interestRate < 0) bad(`${w}.interestRate`, "must not be negative");
  return l;
}

// liability_updates_delta_check.
function parseLiabilityUpdate(raw: unknown, i: number): BackupLiabilityUpdate {
  const w = `liabilityUpdates[${i}]`;
  const o = entry(raw, w);
  const u: BackupLiabilityUpdate = {
    id: uuid(o, "id", w),
    liabilityId: uuid(o, "liabilityId", w),
    date: day(o, "date", w),
    delta: whole(o, "delta", w),
    note: textOrNull(o, "note", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (u.delta === 0) bad(`${w}.delta`, "must not be zero");
  return u;
}

// price_updates_price_check: decimal() already refuses a negative price.
function parsePriceUpdate(raw: unknown, i: number): BackupPriceUpdate {
  const w = `priceUpdates[${i}]`;
  const o = entry(raw, w);
  return {
    id: uuid(o, "id", w),
    holdingId: uuid(o, "holdingId", w),
    date: day(o, "date", w),
    price: decimal(o, "price", w),
    createdAt: stamp(o, "createdAt", w),
  };
}

// Same rule as corporate_actions_kind_values_check in db/schema.ts.
function parseCorporateAction(raw: unknown, i: number): BackupCorporateAction {
  const w = `corporateActions[${i}]`;
  const o = entry(raw, w);
  const c: BackupCorporateAction = {
    id: uuid(o, "id", w),
    holdingId: uuid(o, "holdingId", w),
    kind: oneOf(o, "kind", w, CORPORATE_ACTION_KINDS),
    date: day(o, "date", w),
    quantity: decimalOrNull(o, "quantity", w),
    ratio: decimalOrNull(o, "ratio", w),
    note: textOrNull(o, "note", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (c.kind === "BONUS" && !(c.quantity !== null && !isZeroDecimal(c.quantity) && c.ratio === null)) {
    bad(w, "a BONUS needs a quantity above zero and no ratio");
  }
  if (c.kind === "SPLIT" && !(c.ratio !== null && !isZeroDecimal(c.ratio) && c.quantity === null)) {
    bad(w, "a SPLIT needs a ratio above zero and no quantity");
  }
  if (c.kind === "WRITE_OFF" && (c.quantity !== null || c.ratio !== null)) {
    bad(w, "a WRITE_OFF has neither a quantity nor a ratio");
  }
  return c;
}

// Same rules as the goals_*_check constraints in db/schema.ts.
function parseGoal(raw: unknown, i: number, version: number): BackupGoal {
  const w = `goals[${i}]`;
  const o = entry(raw, w);
  const g: BackupGoal = {
    id: uuid(o, "id", w),
    name: name(o, "name", w),
    targetAmount: whole(o, "targetAmount", w),
    targetMode: version < 5 ? "manual" : oneOf(o, "targetMode", w, GOAL_TARGET_MODES),
    targetMonths: version < 5 ? null : wholeOrNull(o, "targetMonths", w),
    targetDate: day(o, "targetDate", w),
    startDate: day(o, "startDate", w),
    priority: whole(o, "priority", w, "a whole number of 1 or more"),
    plannedMonthly: wholeOrNull(o, "plannedMonthly", w),
    expectedReturnOverride: rateOrNull(o, "expectedReturnOverride", w),
    manualCurrent: wholeOrNull(o, "manualCurrent", w),
    notes: textOrNull(o, "notes", w),
    color: textOrNull(o, "color", w),
    icon: textOrNull(o, "icon", w),
    archivedAt: stampOrNull(o, "archivedAt", w),
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
  if (g.targetAmount <= 0) bad(`${w}.targetAmount`, "must be above zero");
  // Same rule as goals_target_mode_check.
  if ((g.targetMode === "expense_months") !== (g.targetMonths !== null)) {
    bad(w, "targetMonths is set exactly when targetMode is expense_months");
  }
  if (g.targetMonths !== null && (g.targetMonths < 1 || g.targetMonths > 60)) bad(`${w}.targetMonths`, "must be a whole number from 1 to 60");
  if (g.priority < 1 || g.priority > INT4_MAX) bad(`${w}.priority`, `must be a whole number from 1 to ${INT4_MAX}`);
  if (g.plannedMonthly !== null && g.plannedMonthly < 0) bad(`${w}.plannedMonthly`, "must not be negative");
  if (g.manualCurrent !== null && g.manualCurrent < 0) bad(`${w}.manualCurrent`, "must not be negative");
  return g;
}

// Same rules as the allocation_rules checks in db/schema.ts.
function parseRule(raw: unknown, i: number): BackupAllocationRule {
  const w = `allocationRules[${i}]`;
  const o = entry(raw, w);
  const r: BackupAllocationRule = {
    id: uuid(o, "id", w),
    kind: oneOf(o, "kind", w, RULE_KINDS),
    targetKind: oneOf(o, "targetKind", w, TARGET_KINDS),
    goalId: uuidOrNull(o, "goalId", w),
    amount: wholeOrNull(o, "amount", w),
    percent: rateOrNull(o, "percent", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if ((r.goalId !== null) !== (r.targetKind === "goal")) bad(w, "goalId must be set exactly when targetKind is goal");
  if (r.kind === "fixed" && !(r.amount !== null && r.amount > 0 && r.percent === null)) {
    bad(w, "a fixed rule needs an amount above zero and no percent");
  }
  if (r.kind === "percentage" && !(r.percent !== null && r.percent > 0 && r.percent <= 1 && r.amount === null)) {
    bad(w, "a percentage rule needs a percent above 0 and up to 1, and no amount");
  }
  if (r.kind === "remainder" && (r.amount !== null || r.percent !== null)) {
    bad(w, "a remainder rule has neither an amount nor a percent");
  }
  return r;
}

// Same rule as goal_allocations_shape_check: a cash allocation or a share of a holding, exactly one.
function parseGoalAllocation(raw: unknown, i: number, version: number): BackupGoalAllocation {
  const w = `goalAllocations[${i}]`;
  const o = entry(raw, w);
  const v4 = version >= 4;
  const a: BackupGoalAllocation = {
    id: uuid(o, "id", w),
    goalId: uuid(o, "goalId", w),
    accountId: v4 ? uuidOrNull(o, "accountId", w) : uuid(o, "accountId", w),
    amount: v4 ? wholeOrNull(o, "amount", w) : whole(o, "amount", w),
    holdingId: v4 ? uuidOrNull(o, "holdingId", w) : null,
    percent: v4 ? shareOrNull(o, "percent", w) : null,
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
  if (a.amount !== null && a.amount <= 0) bad(`${w}.amount`, "must be above zero");
  if (a.accountId !== null) {
    if (a.amount === null || a.holdingId !== null || a.percent !== null) {
      bad(w, "a cash allocation needs an accountId and an amount, and no holdingId or percent");
    }
  } else if (a.holdingId === null || a.percent === null || !(a.percent > 0 && a.percent <= 1) || a.amount !== null) {
    bad(w, "a holding share needs a holdingId and a percent above 0 and up to 1, and no accountId or amount");
  }
  return a;
}

// Same rules as goal_allocation_events_delta_check and goal_allocation_events_shape_check.
function parseGoalAllocationEvent(raw: unknown, i: number, version: number): BackupGoalAllocationEvent {
  const w = `goalAllocationEvents[${i}]`;
  const o = entry(raw, w);
  const v4 = version >= 4;
  const e: BackupGoalAllocationEvent = {
    id: uuid(o, "id", w),
    goalId: uuid(o, "goalId", w),
    accountId: v4 ? uuidOrNull(o, "accountId", w) : uuid(o, "accountId", w),
    holdingId: v4 ? uuidOrNull(o, "holdingId", w) : null,
    percentDelta: v4 ? shareOrNull(o, "percentDelta", w) : null,
    delta: whole(o, "delta", w),
    date: day(o, "date", w),
    note: textOrNull(o, "note", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (e.delta === 0) bad(`${w}.delta`, "must not be zero");
  if (e.accountId !== null) {
    if (e.holdingId !== null || e.percentDelta !== null) bad(w, "an account event has no holdingId or percentDelta");
  } else if (e.holdingId === null || e.percentDelta === null || e.percentDelta === 0) {
    bad(w, "an event needs an accountId, or a holdingId with a percentDelta that is not zero");
  }
  return e;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseAllocationOverride(raw: unknown, i: number): BackupAllocationOverride {
  const w = `allocationOverrides[${i}]`;
  const o = entry(raw, w);
  const v: BackupAllocationOverride = {
    id: uuid(o, "id", w),
    ruleId: uuid(o, "ruleId", w),
    month: text(o, "month", w),
    amount: whole(o, "amount", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (!MONTH.test(v.month)) bad(`${w}.month`, "must be a month like 2026-03");
  if (v.amount < 0) bad(`${w}.amount`, "must not be negative");
  return v;
}

// budgets_amount_check.
function parseBudget(raw: unknown, i: number): BackupBudget {
  const w = `budgets[${i}]`;
  const o = entry(raw, w);
  const b: BackupBudget = {
    id: uuid(o, "id", w),
    categoryId: uuidOrNull(o, "categoryId", w),
    amount: whole(o, "amount", w),
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
  if (b.amount <= 0) bad(`${w}.amount`, "must be above zero");
  return b;
}

// Same rules as the recurring_templates_*_check constraints in db/schema.ts.
function parseRecurringTemplate(raw: unknown, i: number): BackupRecurringTemplate {
  const w = `recurringTemplates[${i}]`;
  const o = entry(raw, w);
  const t: BackupRecurringTemplate = {
    id: uuid(o, "id", w),
    name: name(o, "name", w),
    type: oneOf(o, "type", w, RECURRING_TYPES),
    amount: whole(o, "amount", w),
    categoryId: uuidOrNull(o, "categoryId", w),
    accountId: uuid(o, "accountId", w),
    frequency: oneOf(o, "frequency", w, RECURRING_FREQUENCIES),
    startDate: day(o, "startDate", w),
    endDate: dayOrNull(o, "endDate", w),
    autoPost: flag(o, "autoPost", w),
    active: flag(o, "active", w),
    note: textOrNull(o, "note", w),
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
  if (t.amount <= 0) bad(`${w}.amount`, "must be above zero");
  if (t.endDate !== null && t.endDate < t.startDate) bad(`${w}.endDate`, "must not be before the start date");
  return t;
}

/** A collection that older files do not have: empty before `since`, required (a list) from then on. */
function listSince(root: Obj, key: string, version: number, since: number): unknown[] {
  return version < since ? [] : list(root, key);
}

function build(input: unknown): Backup {
  if (!isObj(input)) throw new BackupError("Not a TFF backup: the file must contain a JSON object.");
  const version = input.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < OLDEST_VERSION || version > BACKUP_VERSION) {
    bad("version", `${JSON.stringify(version)} is not supported (this app reads versions ${OLDEST_VERSION} to ${BACKUP_VERSION})`);
  }
  const exportedAt = stamp(input, "exportedAt", "backup");
  const settings = parseSettings(input.settings, version);

  const accounts = list(input, "accounts").map((raw, i): BackupAccount => {
    const w = `accounts[${i}]`;
    const o = entry(raw, w);
    return {
      id: uuid(o, "id", w),
      name: name(o, "name", w),
      type: oneOf(o, "type", w, ACCOUNT_TYPES),
      institution: textOrNull(o, "institution", w),
      notes: textOrNull(o, "notes", w),
      isInvestment: flag(o, "isInvestment", w),
      openingBalance: whole(o, "openingBalance", w),
      archivedAt: stampOrNull(o, "archivedAt", w),
      createdAt: stamp(o, "createdAt", w),
      updatedAt: stamp(o, "updatedAt", w),
    };
  });
  unique(accounts.map((a) => a.id), "accounts.id");

  const categories = list(input, "categories").map((raw, i): BackupCategory => {
    const w = `categories[${i}]`;
    const o = entry(raw, w);
    return {
      id: uuid(o, "id", w),
      name: name(o, "name", w),
      kind: oneOf(o, "kind", w, CATEGORY_KINDS),
      isEssential: flag(o, "isEssential", w),
      archivedAt: stampOrNull(o, "archivedAt", w),
      createdAt: stamp(o, "createdAt", w),
    };
  });
  unique(categories.map((c) => c.id), "categories.id");
  unique(categories.map((c) => `${c.kind} ${c.name}`), "categories (kind and name)");

  const transactions = list(input, "transactions").map((raw, i) => parseTransaction(raw, i, version));
  unique(transactions.map((t) => t.id), "transactions.id");

  const accountIds = new Set(accounts.map((a) => a.id));
  const categoryIds = new Set(categories.map((c) => c.id));
  const txIds = new Set(transactions.map((t) => t.id));
  transactions.forEach((t, i) => {
    const w = `transactions[${i}]`;
    if (t.fromAccountId && !accountIds.has(t.fromAccountId)) bad(`${w}.fromAccountId`, "refers to an account that is not in the file");
    if (t.toAccountId && !accountIds.has(t.toAccountId)) bad(`${w}.toAccountId`, "refers to an account that is not in the file");
    if (t.categoryId && !categoryIds.has(t.categoryId)) bad(`${w}.categoryId`, "refers to a category that is not in the file");
    if (t.replacesId && !txIds.has(t.replacesId)) bad(`${w}.replacesId`, "refers to a transaction that is not in the file");
  });
  if (!replaceDepths(transactions)) bad("transactions", "replacesId links form a loop");

  const goals = listSince(input, "goals", version, 2).map((raw, i) => parseGoal(raw, i, version));
  const goalAllocations = listSince(input, "goalAllocations", version, 2).map((raw, i) => parseGoalAllocation(raw, i, version));
  const goalAllocationEvents = listSince(input, "goalAllocationEvents", version, 2).map((raw, i) =>
    parseGoalAllocationEvent(raw, i, version),
  );
  const allocationRules = listSince(input, "allocationRules", version, 2).map(parseRule);
  const allocationOverrides = listSince(input, "allocationOverrides", version, 2).map(parseAllocationOverride);
  unique(goals.map((g) => g.id), "goals.id");
  unique(goalAllocations.map((a) => a.id), "goalAllocations.id");
  unique(goalAllocations.filter((a) => a.accountId).map((a) => `${a.goalId} ${a.accountId}`), "goalAllocations (goal and account)");
  unique(goalAllocations.filter((a) => a.holdingId).map((a) => `${a.goalId} ${a.holdingId}`), "goalAllocations (goal and holding)");
  unique(goalAllocationEvents.map((e) => e.id), "goalAllocationEvents.id");
  unique(allocationRules.map((r) => r.id), "allocationRules.id");
  if (allocationRules.filter((r) => r.kind === "remainder").length > 1) bad("allocationRules", "at most one remainder rule is allowed");
  unique(allocationOverrides.map((o) => o.id), "allocationOverrides.id");
  unique(allocationOverrides.map((o) => `${o.ruleId} ${o.month}`), "allocationOverrides (rule and month)");

  const goalIds = new Set(goals.map((g) => g.id));
  const ruleIds = new Set(allocationRules.map((r) => r.id));
  const needGoal = (id: string | null, where: string) => {
    if (id && !goalIds.has(id)) bad(where, "refers to a goal that is not in the file");
  };
  const needAccount = (id: string | null, where: string) => {
    if (id && !accountIds.has(id)) bad(where, "refers to an account that is not in the file");
  };
  goalAllocations.forEach((a, i) => {
    needGoal(a.goalId, `goalAllocations[${i}].goalId`);
    needAccount(a.accountId, `goalAllocations[${i}].accountId`);
  });
  goalAllocationEvents.forEach((e, i) => {
    needGoal(e.goalId, `goalAllocationEvents[${i}].goalId`);
    needAccount(e.accountId, `goalAllocationEvents[${i}].accountId`);
  });
  allocationRules.forEach((r, i) => needGoal(r.goalId, `allocationRules[${i}].goalId`));
  allocationOverrides.forEach((o, i) => {
    if (!ruleIds.has(o.ruleId)) bad(`allocationOverrides[${i}].ruleId`, "refers to a rule that is not in the file");
  });

  const holdings = listSince(input, "holdings", version, 3).map((raw, i) => parseHolding(raw, i, version));
  const priceUpdates = listSince(input, "priceUpdates", version, 3).map(parsePriceUpdate);
  const corporateActions = listSince(input, "corporateActions", version, 3).map(parseCorporateAction);
  const goldPrices = listSince(input, "goldPrices", version, 4).map(parseGoldPrice);
  const rateHistory = listSince(input, "rateHistory", version, 4).map(parseRateChange);
  const cloudConfirmations = listSince(input, "cloudConfirmations", version, 4).map(parseCloudConfirmation);
  const liabilities = listSince(input, "liabilities", version, 4).map(parseLiability);
  const liabilityUpdates = listSince(input, "liabilityUpdates", version, 4).map(parseLiabilityUpdate);
  const budgets = listSince(input, "budgets", version, 5).map(parseBudget);
  const recurringTemplates = listSince(input, "recurringTemplates", version, 5).map(parseRecurringTemplate);
  const assumptions = parseAssumptions(input.assumptions, version);
  unique(holdings.map((h) => h.id), "holdings.id");
  unique(priceUpdates.map((p) => p.id), "priceUpdates.id");
  unique(corporateActions.map((c) => c.id), "corporateActions.id");
  unique(goldPrices.map((p) => p.id), "goldPrices.id");
  unique(rateHistory.map((r) => r.id), "rateHistory.id");
  unique(cloudConfirmations.map((c) => c.id), "cloudConfirmations.id");
  unique(liabilities.map((l) => l.id), "liabilities.id");
  unique(liabilityUpdates.map((u) => u.id), "liabilityUpdates.id");
  unique(budgets.map((b) => b.id), "budgets.id");
  // Same rules as budgets_user_category_idx and budgets_one_overall_idx.
  unique(budgets.filter((b) => b.categoryId).map((b) => b.categoryId!), "budgets (category)");
  if (budgets.filter((b) => b.categoryId === null).length > 1) bad("budgets", "at most one overall budget (no category) is allowed");
  unique(recurringTemplates.map((t) => t.id), "recurringTemplates.id");
  // Same rule as transactions_recurring_occurrence_idx: one row per template and due date, whatever its status.
  unique(
    transactions.filter((t) => t.recurringTemplateId).map((t) => `${t.recurringTemplateId} ${t.recurringDueDate}`),
    "transactions (recurring template and due date)",
  );

  const holdingIds = new Set(holdings.map((h) => h.id));
  const needHolding = (id: string | null, where: string) => {
    if (id && !holdingIds.has(id)) bad(where, "refers to a holding that is not in the file");
  };
  holdings.forEach((h, i) => needAccount(h.accountId, `holdings[${i}].accountId`));
  const templateIds = new Set(recurringTemplates.map((t) => t.id));
  recurringTemplates.forEach((t, i) => {
    needAccount(t.accountId, `recurringTemplates[${i}].accountId`);
    if (t.categoryId && !categoryIds.has(t.categoryId)) bad(`recurringTemplates[${i}].categoryId`, "refers to a category that is not in the file");
  });
  budgets.forEach((b, i) => {
    if (b.categoryId && !categoryIds.has(b.categoryId)) bad(`budgets[${i}].categoryId`, "refers to a category that is not in the file");
  });
  transactions.forEach((t, i) => {
    if (t.recurringTemplateId && !templateIds.has(t.recurringTemplateId)) {
      bad(`transactions[${i}].recurringTemplateId`, "refers to a recurring template that is not in the file");
    }
  });
  transactions.forEach((t, i) => needHolding(t.holdingId, `transactions[${i}].holdingId`));
  priceUpdates.forEach((p, i) => needHolding(p.holdingId, `priceUpdates[${i}].holdingId`));
  corporateActions.forEach((c, i) => needHolding(c.holdingId, `corporateActions[${i}].holdingId`));
  goalAllocations.forEach((a, i) => needHolding(a.holdingId, `goalAllocations[${i}].holdingId`));
  goalAllocationEvents.forEach((e, i) => needHolding(e.holdingId, `goalAllocationEvents[${i}].holdingId`));
  rateHistory.forEach((r, i) => needHolding(r.holdingId, `rateHistory[${i}].holdingId`));
  cloudConfirmations.forEach((c, i) => needHolding(c.holdingId, `cloudConfirmations[${i}].holdingId`));

  const holdingById = new Map(holdings.map((h) => [h.id, h]));
  const needCloud = (id: string, where: string) => {
    if (holdingById.get(id)?.kind !== "cloud") bad(where, "must belong to a cloud holding");
  };
  rateHistory.forEach((r, i) => needCloud(r.holdingId, `rateHistory[${i}].holdingId`));
  cloudConfirmations.forEach((c, i) => needCloud(c.holdingId, `cloudConfirmations[${i}].holdingId`));

  const liabilityIds = new Set(liabilities.map((l) => l.id));
  transactions.forEach((t, i) => {
    if (t.liabilityId && !liabilityIds.has(t.liabilityId)) bad(`transactions[${i}].liabilityId`, "refers to a liability that is not in the file");
  });
  liabilityUpdates.forEach((u, i) => {
    if (!liabilityIds.has(u.liabilityId)) bad(`liabilityUpdates[${i}].liabilityId`, "refers to a liability that is not in the file");
  });

  // Which of quantity and unitPrice a holding's trade carries depends on its kind: a cloud has neither, the rest need both.
  transactions.forEach((t, i) => {
    const h = t.holdingId ? holdingById.get(t.holdingId) : undefined;
    if (!h) return;
    const w = `transactions[${i}]`;
    if (t.type === "DIVIDEND") {
      if (h.kind === "cloud" || h.kind === "gold") bad(`${w}.holdingId`, `a ${h.kind} holding has no dividends`);
    } else if (h.kind === "cloud") {
      if (t.quantity !== null) bad(w, "a cloud deposit or withdrawal has no quantity or unitPrice");
    } else if (t.quantity === null) {
      bad(w, `${t.type} on a holding needs a quantity above zero and a unitPrice`);
    }
  });

  // Rule F: a position that goes impossible on any date is refused before anything is written.
  const events = eventsByHolding(toHoldingEvents(transactions, corporateActions));
  holdings.forEach((h, i) => {
    const check = validateHistory(events.get(h.id) ?? []);
    // No quantities in the message (the engine's own text quotes them): error text is plain text, which privacy mode does not hide.
    if (!check.ok) bad(`holdings[${i}]`, `the history leaves an impossible position (on ${check.date})`);
  });

  // The cash of a posted unit trade must be what quantity x unitPrice (+/- fee and tax) says it is. The generic
  // message keeps amounts out of it: error text is plain text, which privacy mode does not hide.
  transactions.forEach((t, i) => {
    const h = t.holdingId ? holdingById.get(t.holdingId) : undefined;
    if (!h || h.kind === "cloud" || t.status !== "posted" || t.quantity === null || t.unitPrice === null) return;
    const w = `transactions[${i}]`;
    try {
      if (t.type === "INVESTMENT_PURCHASE" && t.amount !== purchaseCash(t.quantity, t.unitPrice, t.fee)) {
        bad(`${w}.amount`, "does not equal quantity x unitPrice plus fee");
      }
      if (t.type === "INVESTMENT_SALE") {
        if (t.amount !== saleCash(t.quantity, t.unitPrice, t.fee, t.taxWithheld ?? 0)) {
          bad(`${w}.amount`, "does not equal quantity x unitPrice minus fee and tax withheld");
        }
        if (t.grossAmount !== lineValue(t.quantity, t.unitPrice)) bad(`${w}.grossAmount`, "does not equal quantity x unitPrice");
      }
    } catch (e) {
      if (e instanceof RangeError) bad(w, "cannot be priced");
      throw e;
    }
  });

  // A cloud's withdrawals never exceed its estimated value at the time. Same engine call the actions use.
  const stampOf = (v: string) => new Date(v).toISOString(); // the engine orders by text, so normalise ".000Z" and "Z"
  holdings.forEach((h, i) => {
    if (h.kind !== "cloud") return;
    const cashFlows: CashFlow[] = transactions
      .filter((t) => t.holdingId === h.id && t.status === "posted" && (t.type === "INVESTMENT_PURCHASE" || t.type === "INVESTMENT_SALE"))
      .map((t) => ({ date: t.date, createdAt: stampOf(t.createdAt), kind: t.type === "INVESTMENT_PURCHASE" ? "deposit" : "withdrawal", amount: t.amount }));
    const rates: RateChange[] = rateHistory
      .filter((r) => r.holdingId === h.id)
      .map((r) => ({ date: r.effectiveDate, createdAt: stampOf(r.createdAt), apy: r.apy }));
    const confirmations: Confirmation[] = cloudConfirmations
      .filter((c) => c.holdingId === h.id)
      .map((c) => ({ date: c.date, createdAt: stampOf(c.createdAt), value: c.value }));
    try {
      const check = validateCloudHistory({ confirmations, cashFlows, rates });
      if (!check.ok) bad(`holdings[${i}]`, `a withdrawal is larger than the cloud's estimated value (on ${check.date})`);
    } catch (e) {
      if (e instanceof RangeError) bad(`holdings[${i}]`, "cannot be valued");
      throw e;
    }
  });

  // Same rule as recordPayment and addLiabilityUpdate: replayed in date order, the balance (opening + manual updates -
  // posted principal payments) is never below zero at the end of any date. No amounts in the message.
  liabilities.forEach((l, i) => {
    const check = validateLiabilityHistory(
      l.openingBalance,
      liabilityUpdates.filter((u) => u.liabilityId === l.id),
      transactions
        .filter((t) => t.type === "LIABILITY_PAYMENT" && t.status === "posted" && t.liabilityId === l.id)
        .map((t) => ({ date: t.date, amount: t.amount })),
    );
    if (!check.ok) bad(`liabilities[${i}]`, `the balance goes below zero on ${check.date}`);
  });

  // The shares of one holding across all goals add up to at most 100%, counted in whole millionths.
  const claimed = new Map<string, number>();
  for (const a of goalAllocations) {
    if (a.holdingId && a.percent !== null) claimed.set(a.holdingId, (claimed.get(a.holdingId) ?? 0) + micro(a.percent));
  }
  for (const [holdingId, total] of claimed) {
    if (total > 1_000_000) bad("goalAllocations", `the shares of holding ${holdingId} add up to more than 100%`);
  }

  // An older file becomes the current shape: its new collections are empty and its new settings are the defaults.
  return {
    version: BACKUP_VERSION,
    exportedAt,
    settings,
    accounts,
    categories,
    transactions,
    goals,
    goalAllocations,
    goalAllocationEvents,
    allocationRules,
    allocationOverrides,
    holdings,
    priceUpdates,
    corporateActions,
    goldPrices,
    rateHistory,
    cloudConfirmations,
    liabilities,
    liabilityUpdates,
    budgets,
    recurringTemplates,
    assumptions,
  };
}

/** Validates everything before anything is written; the error names the first problem found. */
export function parseBackup(input: unknown): { ok: true; backup: Backup } | { ok: false; error: string } {
  try {
    return { ok: true, backup: build(input) };
  } catch (e) {
    if (e instanceof BackupError) return { ok: false, error: e.message };
    throw e;
  }
}

// ---- CSV ----

// Cells that start with these are run as formulas by spreadsheets; a leading ' makes them plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | null): string {
  const v = value ?? "";
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** "-1250.50": exact integer math, no thousands separators, so spreadsheets read it as a number. */
function egp2(amount: Piasters): string {
  const abs = Math.abs(amount);
  return `${amount < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

type CsvTx = Pick<
  BackupTransaction,
  "date" | "type" | "amount" | "fromAccountId" | "toAccountId" | "categoryId" | "note" | "status"
>;

/** One row per transaction in the order given, void rows included (the status column says which). CRLF line ends. */
export function transactionsToCsv(
  rows: CsvTx[],
  accountsById: ReadonlyMap<string, { name: string }>,
  categoriesById: ReadonlyMap<string, { name: string }>,
): string {
  const lines = [["date", "type", "amount", "from_account", "to_account", "category", "note", "status"].join(",")];
  for (const r of rows) {
    const nameOf = (m: ReadonlyMap<string, { name: string }>, id: string | null) => (id ? (m.get(id)?.name ?? id) : null);
    lines.push(
      [
        r.date,
        r.type,
        egp2(r.amount), // generated here, never user text, so it is exempt from the formula guard (a negative starts with "-")
        cell(nameOf(accountsById, r.fromAccountId)),
        cell(nameOf(accountsById, r.toAccountId)),
        cell(nameOf(categoriesById, r.categoryId)),
        cell(r.note),
        r.status,
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
