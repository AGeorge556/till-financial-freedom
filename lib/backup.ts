import type { RuleKind, SavingsTargetMode, TargetKind } from "./finance-core/allocation";
import type { TxType } from "./finance-core/ledger";
import type { Piasters } from "./finance-core/money";

// Pure: no React, Next.js or database imports. The enum lists below mirror db/schema.ts (backup.test.ts checks they match).

export const BACKUP_VERSION = 2;
// Version 1 files (no goals, rules or savings settings) still restore.
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
export const SAVINGS_MODES = ["fixed", "percentage", "flexible"] as const satisfies readonly SavingsTargetMode[];
export const RULE_KINDS = ["fixed", "percentage", "remainder"] as const satisfies readonly RuleKind[];
export const TARGET_KINDS = ["goal", "investments", "cash"] as const satisfies readonly TargetKind[];

// Postgres limits behind the checks below: integer columns hold up to 2^31-1, numeric(8,6) rates stay under 100.
const INT4_MAX = 2_147_483_647;
const RATE_LIMIT = 100;

type AccountType = (typeof ACCOUNT_TYPES)[number];
type CategoryKind = (typeof CATEGORY_KINDS)[number];
type TxStatus = (typeof TX_STATUSES)[number];

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
  replacesId: string | null;
  voidedAt: string | null;
  createdAt: string;
};

export type BackupSettings = {
  monthStartDay: number;
  savingsTargetMode: SavingsTargetMode;
  savingsTargetAmount: Piasters | null;
  /** Decimal: 0.2 = 20%. */
  savingsTargetPercent: number | null;
  expectedMonthlyIncome: Piasters | null;
  expectedMonthlySpending: Piasters | null;
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
  };
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

const textOrNull = orNull(text);
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

function parseTransaction(raw: unknown, i: number): BackupTransaction {
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
    };
  }
  return {
    monthStartDay,
    savingsTargetMode: oneOf(o, "savingsTargetMode", "settings", SAVINGS_MODES),
    savingsTargetAmount: wholeOrNull(o, "savingsTargetAmount", "settings"),
    savingsTargetPercent: rateOrNull(o, "savingsTargetPercent", "settings"),
    expectedMonthlyIncome: wholeOrNull(o, "expectedMonthlyIncome", "settings"),
    expectedMonthlySpending: wholeOrNull(o, "expectedMonthlySpending", "settings"),
  };
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

/** A collection that version 1 files do not have: empty for them, required (a list) for version 2. */
function listSince2(root: Obj, key: string, version: number): unknown[] {
  return version < 2 ? [] : list(root, key);
}

function build(input: unknown): Backup {
  if (!isObj(input)) throw new BackupError("Not a Till backup: the file must contain a JSON object.");
  const version = input.version;
  if (version !== OLDEST_VERSION && version !== BACKUP_VERSION) {
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

  const transactions = list(input, "transactions").map(parseTransaction);
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

  const goals = listSince2(input, "goals", version).map(parseGoal);
  const goalAllocations = listSince2(input, "goalAllocations", version).map(parseGoalAllocation);
  const goalAllocationEvents = listSince2(input, "goalAllocationEvents", version).map(parseGoalAllocationEvent);
  const allocationRules = listSince2(input, "allocationRules", version).map(parseRule);
  const allocationOverrides = listSince2(input, "allocationOverrides", version).map(parseAllocationOverride);
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

  // A version 1 file becomes the current shape: its new collections are empty and its settings are the defaults.
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
