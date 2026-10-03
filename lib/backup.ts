import type { RuleKind, SavingsTargetMode, TargetKind } from "./finance-core/allocation";
import type { TxType } from "./finance-core/ledger";
import type { Piasters } from "./finance-core/money";
import { DEFAULT_STALE_DAYS, type HoldingEvent, validateHistory } from "./finance-core/portfolio";

// Pure: no React, Next.js or database imports. The enum lists below mirror db/schema.ts (backup.test.ts checks they match).

export const BACKUP_VERSION = 3;
// Version 1 files (no goals, rules or savings settings) and version 2 files (no holdings) still restore.
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
export const HOLDING_KINDS = ["stock", "fund", "other"] as const;
export const CORPORATE_ACTION_KINDS = ["BONUS", "SPLIT", "WRITE_OFF"] as const;
export const SAVINGS_MODES = ["fixed", "percentage", "flexible"] as const satisfies readonly SavingsTargetMode[];
export const RULE_KINDS = ["fixed", "percentage", "remainder"] as const satisfies readonly RuleKind[];
export const TARGET_KINDS = ["goal", "investments", "cash"] as const satisfies readonly TargetKind[];

// Postgres limits behind the checks below: integer columns hold up to 2^31-1, numeric(8,6) rates stay under 100.
const INT4_MAX = 2_147_483_647;
const RATE_LIMIT = 100;

type AccountType = (typeof ACCOUNT_TYPES)[number];
type CategoryKind = (typeof CATEGORY_KINDS)[number];
type TxStatus = (typeof TX_STATUSES)[number];
type HoldingKind = (typeof HOLDING_KINDS)[number];
type CorporateActionKind = (typeof CORPORATE_ACTION_KINDS)[number];

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
  /** Decimal string (NUMERIC(20,6)); set exactly on holding-linked purchases and sales. */
  quantity: string | null;
  unitPrice: string | null;
  replacesId: string | null;
  voidedAt: string | null;
  createdAt: string;
};

export type BackupHolding = {
  id: string;
  accountId: string;
  kind: HoldingKind;
  name: string;
  ticker: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
};

export type BackupGoal = {
  id: string;
  name: string;
  targetAmount: Piasters;
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

export type BackupGoalAllocation = {
  id: string;
  goalId: string;
  accountId: string;
  amount: Piasters;
  createdAt: string;
  updatedAt: string;
};

export type BackupGoalAllocationEvent = {
  id: string;
  goalId: string;
  accountId: string;
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
  assumptions: BackupAssumptions;
};

// Database rows carry Date timestamps, and numeric rates may arrive as strings from the driver.
type Dated<T, K extends keyof T> = Omit<T, K> & { [P in K]: null extends T[P] ? Date | null : Date };
type Rated<T, K extends keyof T> = Omit<T, K> & { [P in K]: number | string | null };
type AccountRow = Dated<BackupAccount, "archivedAt" | "createdAt" | "updatedAt">;
type CategoryRow = Dated<BackupCategory, "archivedAt" | "createdAt">;
type TransactionRow = Dated<BackupTransaction, "voidedAt" | "createdAt">;
type SettingsRow = Rated<BackupSettings, "savingsTargetPercent">;
type GoalRow = Rated<Dated<BackupGoal, "archivedAt" | "createdAt" | "updatedAt">, "expectedReturnOverride">;
type GoalAllocationRow = Dated<BackupGoalAllocation, "createdAt" | "updatedAt">;
type GoalAllocationEventRow = Dated<BackupGoalAllocationEvent, "createdAt">;
type AllocationRuleRow = Rated<Dated<BackupAllocationRule, "createdAt">, "percent">;
type AllocationOverrideRow = Dated<BackupAllocationOverride, "createdAt">;
type HoldingRow = Dated<BackupHolding, "archivedAt" | "createdAt" | "updatedAt">;
type PriceUpdateRow = Dated<BackupPriceUpdate, "createdAt">;
type CorporateActionRow = Dated<BackupCorporateAction, "createdAt">;
type AssumptionsRow = { [K in keyof BackupAssumptions]: number | string | null };

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const numOrNull = (v: number | string | null) => (v === null ? null : Number(v));

/** Database rows (Date timestamps, with user_id) to the backup shape. Fields are copied by name, so user_id never leaks in. */
export function serializeBackup(
  rows: {
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
    assumptions: AssumptionsRow;
  },
  exportedAt: Date = new Date(),
): Backup {
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
      replacesId: t.replacesId,
      voidedAt: isoOrNull(t.voidedAt),
      createdAt: iso(t.createdAt),
    })),
    goals: rows.goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount,
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
      createdAt: iso(a.createdAt),
      updatedAt: iso(a.updatedAt),
    })),
    goalAllocationEvents: rows.goalAllocationEvents.map((e) => ({
      id: e.id,
      goalId: e.goalId,
      accountId: e.accountId,
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
    assumptions: {
      stockReturn: numOrNull(rows.assumptions.stockReturn),
      goldReturn: numOrNull(rows.assumptions.goldReturn),
      savingsCloudApy: numOrNull(rows.assumptions.savingsCloudApy),
      cashReturn: numOrNull(rows.assumptions.cashReturn),
      inflation: numOrNull(rows.assumptions.inflation),
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
 * (rule E). createdAt is normalised to ISO so the engine's text ordering is right for any input.
 */
export function toHoldingEvents(txs: EventTx[], actions: EventAction[]): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const t of txs) {
    if (t.status !== "posted" || !t.holdingId) continue;
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

const textOrNull = orNull(text);
const decimalOrNull = orNull(decimal);
const wholeOrNull = orNull((o: Obj, k: string, w: string) => whole(o, k, w));
const rateOrNull = orNull(rate);
const uuidOrNull = orNull(uuid);
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
    replacesId: uuidOrNull(o, "replacesId", w),
    voidedAt: stampOrNull(o, "voidedAt", w),
    createdAt: stamp(o, "createdAt", w),
  };

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
  const trade = (t.type === "INVESTMENT_PURCHASE" || t.type === "INVESTMENT_SALE") && t.holdingId !== null;
  if (trade) {
    if (t.quantity === null || t.unitPrice === null || isZeroDecimal(t.quantity)) {
      bad(w, `${t.type} on a holding needs a quantity above zero and a unitPrice`);
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
    };
  }
  // Same rule as user_settings_stale_days_holdings_range in db/schema.ts.
  const staleDaysHoldings =
    version < 3 ? DEFAULT_STALE_DAYS : whole(o, "staleDaysHoldings", "settings", "a whole number of days from 1 to 365");
  if (staleDaysHoldings < 1 || staleDaysHoldings > 365) {
    bad("settings.staleDaysHoldings", "must be a whole number of days from 1 to 365");
  }
  return {
    monthStartDay,
    savingsTargetMode: oneOf(o, "savingsTargetMode", "settings", SAVINGS_MODES),
    savingsTargetAmount: wholeOrNull(o, "savingsTargetAmount", "settings"),
    savingsTargetPercent: rateOrNull(o, "savingsTargetPercent", "settings"),
    expectedMonthlyIncome: wholeOrNull(o, "expectedMonthlyIncome", "settings"),
    expectedMonthlySpending: wholeOrNull(o, "expectedMonthlySpending", "settings"),
    staleDaysHoldings,
  };
}

function parseAssumptions(raw: unknown, version: number): BackupAssumptions {
  if (version < 3) return { stockReturn: null, goldReturn: null, savingsCloudApy: null, cashReturn: null, inflation: null };
  const o = entry(raw, "assumptions");
  return {
    stockReturn: rateOrNull(o, "stockReturn", "assumptions"),
    goldReturn: rateOrNull(o, "goldReturn", "assumptions"),
    savingsCloudApy: rateOrNull(o, "savingsCloudApy", "assumptions"),
    cashReturn: rateOrNull(o, "cashReturn", "assumptions"),
    inflation: rateOrNull(o, "inflation", "assumptions"),
  };
}

function parseHolding(raw: unknown, i: number): BackupHolding {
  const w = `holdings[${i}]`;
  const o = entry(raw, w);
  return {
    id: uuid(o, "id", w),
    accountId: uuid(o, "accountId", w),
    kind: oneOf(o, "kind", w, HOLDING_KINDS),
    name: name(o, "name", w),
    ticker: textOrNull(o, "ticker", w),
    notes: textOrNull(o, "notes", w),
    archivedAt: stampOrNull(o, "archivedAt", w),
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
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
function parseGoal(raw: unknown, i: number): BackupGoal {
  const w = `goals[${i}]`;
  const o = entry(raw, w);
  const g: BackupGoal = {
    id: uuid(o, "id", w),
    name: name(o, "name", w),
    targetAmount: whole(o, "targetAmount", w),
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

function parseGoalAllocation(raw: unknown, i: number): BackupGoalAllocation {
  const w = `goalAllocations[${i}]`;
  const o = entry(raw, w);
  const a: BackupGoalAllocation = {
    id: uuid(o, "id", w),
    goalId: uuid(o, "goalId", w),
    accountId: uuid(o, "accountId", w),
    amount: whole(o, "amount", w),
    createdAt: stamp(o, "createdAt", w),
    updatedAt: stamp(o, "updatedAt", w),
  };
  if (a.amount <= 0) bad(`${w}.amount`, "must be above zero");
  return a;
}

function parseGoalAllocationEvent(raw: unknown, i: number): BackupGoalAllocationEvent {
  const w = `goalAllocationEvents[${i}]`;
  const o = entry(raw, w);
  const e: BackupGoalAllocationEvent = {
    id: uuid(o, "id", w),
    goalId: uuid(o, "goalId", w),
    accountId: uuid(o, "accountId", w),
    delta: whole(o, "delta", w),
    date: day(o, "date", w),
    note: textOrNull(o, "note", w),
    createdAt: stamp(o, "createdAt", w),
  };
  if (e.delta === 0) bad(`${w}.delta`, "must not be zero");
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

/** A collection that older files do not have: empty before `since`, required (a list) from then on. */
function listSince(root: Obj, key: string, version: number, since: number): unknown[] {
  return version < since ? [] : list(root, key);
}

function build(input: unknown): Backup {
  if (!isObj(input)) throw new BackupError("Not a Till backup: the file must contain a JSON object.");
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

  const goals = listSince(input, "goals", version, 2).map(parseGoal);
  const goalAllocations = listSince(input, "goalAllocations", version, 2).map(parseGoalAllocation);
  const goalAllocationEvents = listSince(input, "goalAllocationEvents", version, 2).map(parseGoalAllocationEvent);
  const allocationRules = listSince(input, "allocationRules", version, 2).map(parseRule);
  const allocationOverrides = listSince(input, "allocationOverrides", version, 2).map(parseAllocationOverride);
  unique(goals.map((g) => g.id), "goals.id");
  unique(goalAllocations.map((a) => a.id), "goalAllocations.id");
  unique(goalAllocations.map((a) => `${a.goalId} ${a.accountId}`), "goalAllocations (goal and account)");
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
  const needAccount = (id: string, where: string) => {
    if (!accountIds.has(id)) bad(where, "refers to an account that is not in the file");
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

  const holdings = listSince(input, "holdings", version, 3).map(parseHolding);
  const priceUpdates = listSince(input, "priceUpdates", version, 3).map(parsePriceUpdate);
  const corporateActions = listSince(input, "corporateActions", version, 3).map(parseCorporateAction);
  const assumptions = parseAssumptions(input.assumptions, version);
  unique(holdings.map((h) => h.id), "holdings.id");
  unique(priceUpdates.map((p) => p.id), "priceUpdates.id");
  unique(corporateActions.map((c) => c.id), "corporateActions.id");

  const holdingIds = new Set(holdings.map((h) => h.id));
  const needHolding = (id: string | null, where: string) => {
    if (id && !holdingIds.has(id)) bad(where, "refers to a holding that is not in the file");
  };
  holdings.forEach((h, i) => needAccount(h.accountId, `holdings[${i}].accountId`));
  transactions.forEach((t, i) => needHolding(t.holdingId, `transactions[${i}].holdingId`));
  priceUpdates.forEach((p, i) => needHolding(p.holdingId, `priceUpdates[${i}].holdingId`));
  corporateActions.forEach((c, i) => needHolding(c.holdingId, `corporateActions[${i}].holdingId`));

  // Rule F: a position that goes impossible on any date is refused before anything is written.
  const events = eventsByHolding(toHoldingEvents(transactions, corporateActions));
  holdings.forEach((h, i) => {
    const check = validateHistory(events.get(h.id) ?? []);
    if (!check.ok) bad(`holdings[${i}]`, `impossible position: ${check.error} (on ${check.date})`);
  });

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
