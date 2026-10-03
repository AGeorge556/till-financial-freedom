import { describe, expect, it } from "vitest";
import {
  accountType,
  allocationRuleKind,
  allocationTargetKind,
  categoryKind,
  savingsTargetMode,
  transactionStatus,
  transactionType,
} from "../db/schema";
import {
  ACCOUNT_TYPES,
  BACKUP_VERSION,
  CATEGORY_KINDS,
  insertOrder,
  parseBackup,
  RULE_KINDS,
  SAVINGS_MODES,
  serializeBackup,
  TARGET_KINDS,
  transactionsToCsv,
  TX_STATUSES,
  TX_TYPES,
  type Backup,
} from "./backup";
import { accountBalance, type Tx } from "./finance-core/ledger";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BANK = id(1);
const CASH = id(2);
const CARD = id(3);
const FOOD = id(11);
const SALARY = id(12);
const TRIP = id(22);
const EMERGENCY = id(21);
const FIXED_RULE = id(51);
const at = (s: string) => new Date(s);

// Shaped like Drizzle rows, user_id included, to prove it never reaches the file.
const base = { userId: "user-1", createdAt: at("2026-03-01T08:00:00.000Z") };
const rows = {
  settings: {
    monthStartDay: 25,
    savingsTargetMode: "percentage" as const,
    savingsTargetAmount: null as number | null,
    savingsTargetPercent: "0.200000" as string | null, // numeric columns arrive as text
    expectedMonthlyIncome: 3_000_000 as number | null,
    expectedMonthlySpending: 1_800_000 as number | null,
  },
  accounts: [
    { ...base, id: BANK, name: "CIB", type: "bank" as const, institution: "CIB", notes: null, isInvestment: false, openingBalance: 5_000_000, archivedAt: null, updatedAt: at("2026-03-02T08:00:00.000Z") },
    { ...base, id: CASH, name: "Cash", type: "cash" as const, institution: null, notes: "wallet, \"left\"", isInvestment: false, openingBalance: 0, archivedAt: at("2026-04-01T00:00:00.000Z"), updatedAt: base.createdAt },
    { ...base, id: CARD, name: "Visa", type: "credit_card" as const, institution: null, notes: null, isInvestment: false, openingBalance: -120_000, archivedAt: null, updatedAt: base.createdAt },
  ],
  categories: [
    { ...base, id: FOOD, name: "Food", kind: "expense" as const, isEssential: true, archivedAt: null },
    { ...base, id: SALARY, name: "Salary", kind: "income" as const, isEssential: false, archivedAt: null },
  ],
  transactions: [
    tx(101, { type: "INCOME", amount: 3_000_000, toAccountId: BANK, categoryId: SALARY }),
    tx(102, { type: "EXPENSE", amount: 45_050, fromAccountId: BANK, categoryId: FOOD, note: "lunch" }),
    // 103 was edited: voided, replaced by 104 (which carries a different amount)
    tx(103, { type: "EXPENSE", amount: 10_000, fromAccountId: CARD, categoryId: FOOD, status: "void", voidedAt: at("2026-03-12T10:00:00.000Z") }),
    tx(104, { type: "EXPENSE", amount: 12_000, fromAccountId: CARD, categoryId: FOOD, replacesId: id(103) }),
    tx(105, { type: "TRANSFER", amount: 500_000, fromAccountId: BANK, toAccountId: CASH }),
    tx(106, { type: "ADJUSTMENT", amount: -7_500, toAccountId: CASH }),
    tx(107, { type: "INVESTMENT_PURCHASE", amount: 100_000, fromAccountId: BANK, fee: 150, grossAmount: 99_850, status: "pending" }),
  ],
  goals: [
    { ...base, id: EMERGENCY, name: "Emergency fund", targetAmount: 10_000_000, targetDate: "2027-12-31", startDate: "2026-03-01", priority: 1, plannedMonthly: 500_000 as number | null, expectedReturnOverride: "0.120000" as string | null, manualCurrent: null as number | null, notes: "six months", color: "#22aa77", icon: "shield", archivedAt: null as Date | null, updatedAt: at("2026-03-05T08:00:00.000Z") },
    { ...base, id: TRIP, name: "Trip", targetAmount: 2_000_000, targetDate: "2026-12-01", startDate: "2026-03-01", priority: 2, plannedMonthly: null, expectedReturnOverride: null, manualCurrent: 150_000, notes: null, color: null, icon: null, archivedAt: at("2026-06-01T00:00:00.000Z"), updatedAt: base.createdAt },
  ],
  goalAllocations: [
    { ...base, id: id(31), goalId: EMERGENCY, accountId: BANK, amount: 800_000, updatedAt: at("2026-03-12T08:00:00.000Z") },
    { ...base, id: id(32), goalId: EMERGENCY, accountId: CASH, amount: 100_000, updatedAt: base.createdAt },
  ],
  goalAllocationEvents: [
    { ...base, id: id(41), goalId: EMERGENCY, accountId: BANK, delta: 900_000, date: "2026-03-10", note: null as string | null },
    { ...base, id: id(42), goalId: EMERGENCY, accountId: BANK, delta: -100_000, date: "2026-03-12", note: "moved to cash" },
    { ...base, id: id(43), goalId: EMERGENCY, accountId: CASH, delta: 100_000, date: "2026-03-12", note: null },
  ],
  allocationRules: [
    { ...base, id: FIXED_RULE, kind: "fixed" as "fixed" | "percentage" | "remainder", targetKind: "goal" as "goal" | "investments" | "cash", goalId: EMERGENCY as string | null, amount: 500_000 as number | null, percent: null as string | null },
    { ...base, id: id(52), kind: "percentage" as const, targetKind: "investments" as const, goalId: null, amount: null, percent: "0.250000" },
    { ...base, id: id(53), kind: "remainder" as const, targetKind: "cash" as const, goalId: null, amount: null, percent: null },
  ],
  allocationOverrides: [
    { ...base, id: id(61), ruleId: FIXED_RULE, month: "2026-04", amount: 0 },
    { ...base, id: id(62), ruleId: FIXED_RULE, month: "2026-05", amount: 250_000 },
  ],
};

function tx(n: number, f: Record<string, unknown>) {
  return {
    userId: "user-1",
    id: id(n),
    type: "EXPENSE" as "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT" | "INVESTMENT_PURCHASE",
    date: "2026-03-10",
    amount: 100,
    fromAccountId: null as string | null,
    toAccountId: null as string | null,
    categoryId: null as string | null,
    note: null as string | null,
    status: "posted" as "posted" | "void" | "pending",
    fee: 0,
    grossAmount: null as number | null,
    taxWithheld: null as number | null,
    realizedPl: null as number | null,
    replacesId: null as string | null,
    voidedAt: null as Date | null,
    createdAt: at("2026-03-10T09:00:00.000Z"),
    ...f,
  };
}

const EXPORTED_AT = at("2026-10-03T12:00:00.000Z");
const valid = (): Backup => JSON.parse(JSON.stringify(serializeBackup(rows, EXPORTED_AT)));

const ledger = (b: { transactions: Backup["transactions"] }): Tx[] =>
  b.transactions.map((t) => ({
    type: t.type,
    date: t.date,
    amount: t.amount,
    fromAccountId: t.fromAccountId ?? undefined,
    toAccountId: t.toAccountId ?? undefined,
    status: t.status,
  }));
const balances = (b: { accounts: { id: string; openingBalance: number }[]; transactions: Backup["transactions"] }) =>
  Object.fromEntries(b.accounts.map((a) => [a.id, accountBalance(a.openingBalance, a.id, ledger(b))]));

describe("backup format", () => {
  it("lists the same enum values as db/schema.ts", () => {
    expect([ACCOUNT_TYPES, CATEGORY_KINDS, TX_TYPES, TX_STATUSES, SAVINGS_MODES, RULE_KINDS, TARGET_KINDS]).toEqual([
      accountType.enumValues,
      categoryKind.enumValues,
      transactionType.enumValues,
      transactionStatus.enumValues,
      savingsTargetMode.enumValues,
      allocationRuleKind.enumValues,
      allocationTargetKind.enumValues,
    ]);
  });

  it("round trips through JSON with equal data and equal engine balances, and never carries user_id", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    const json = JSON.stringify(backup);
    expect(json).not.toContain("userId");
    expect(json).not.toContain("user-1");

    const parsed = parseBackup(JSON.parse(json));
    expect(parsed).toEqual({ ok: true, backup });
    if (!parsed.ok) return;

    const before = balances({ accounts: rows.accounts, transactions: serializeBackup(rows).transactions });
    expect(before).toEqual({ [BANK]: 5_000_000 + 3_000_000 - 45_050 - 500_000, [CASH]: 500_000 - 7_500, [CARD]: -120_000 - 12_000 });
    expect(balances(parsed.backup)).toEqual(before);
    expect(parsed.backup.transactions[3].replacesId).toBe(id(103));
  });

  it("round trips goals, allocations, events, rules, overrides and the savings settings, with rates as numbers", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.settings).toEqual({
      monthStartDay: 25,
      savingsTargetMode: "percentage",
      savingsTargetAmount: null,
      savingsTargetPercent: 0.2,
      expectedMonthlyIncome: 3_000_000,
      expectedMonthlySpending: 1_800_000,
    });
    expect(backup.goals.map((g) => g.expectedReturnOverride)).toEqual([0.12, null]);
    expect(backup.allocationRules.map((r) => r.percent)).toEqual([null, 0.25, null]);

    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed).toEqual({ ok: true, backup });
    expect([backup.goals.length, backup.goalAllocations.length, backup.goalAllocationEvents.length]).toEqual([2, 2, 3]);
    expect([backup.allocationRules.length, backup.allocationOverrides.length]).toEqual([3, 2]);
  });
});

describe("version 1 files", () => {
  // What the previous app version wrote: no goals, rules or savings settings.
  const v1 = () => {
    const b: any = valid(); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const key of ["goals", "goalAllocations", "goalAllocationEvents", "allocationRules", "allocationOverrides"]) delete b[key];
    b.version = 1;
    b.settings = { monthStartDay: 25 };
    return b;
  };

  it("still restore, with empty new collections and default settings", () => {
    const file = v1();
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const b = parsed.backup;
    expect(b.version).toBe(BACKUP_VERSION);
    expect([b.goals, b.goalAllocations, b.goalAllocationEvents, b.allocationRules, b.allocationOverrides]).toEqual([[], [], [], [], []]);
    expect(b.settings).toEqual({
      monthStartDay: 25,
      savingsTargetMode: "flexible",
      savingsTargetAmount: null,
      savingsTargetPercent: null,
      expectedMonthlyIncome: null,
      expectedMonthlySpending: null,
    });
    expect(b.accounts).toEqual(file.accounts);
    expect(balances(b)).toEqual(balances(file));
  });

  it("are still validated like before", () => {
    const file = v1();
    file.transactions[0].amount = 0;
    expect(parseBackup(file)).toMatchObject({ ok: false });
  });
});

// any: the point of these cases is to break the shape on purpose.
type Mutate = (b: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
const tx0 = (b: Backup) => b.transactions[0];
const expense = (b: Backup) => b.transactions[1];
const transfer = (b: Backup) => b.transactions[4];

function rejects(table: [string, Mutate, string][]) {
  it.each(table)("%s", (_name, mutate, message) => {
    const b = valid();
    mutate(b);
    const result = parseBackup(b);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
}

describe("parseBackup rejects", () => {
  describe("a file that is not a backup", () => {
    it.each([[null], ["text"], [[]], [42]])("%j", (input) => {
      const result = parseBackup(input);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.error).toContain("JSON object");
    });
    rejects([
      ["unknown version", (b) => (b.version = 3 as never), "version: 3 is not supported"],
      ["version 0", (b) => (b.version = 0 as never), "version: 0 is not supported"],
      ["missing version", (b) => delete b.version, "version: undefined"],
      ["accounts not a list", (b) => (b.accounts = {} as never), "accounts: must be a list"],
      ["transactions missing", (b) => delete b.transactions, "transactions: must be a list"],
      ["settings missing", (b) => delete b.settings, "settings: must be an object"],
      ["goals missing", (b) => delete b.goals, "goals: must be a list"],
      ["goalAllocations not a list", (b) => (b.goalAllocations = {} as never), "goalAllocations: must be a list"],
      ["goalAllocationEvents missing", (b) => delete b.goalAllocationEvents, "goalAllocationEvents: must be a list"],
      ["allocationRules missing", (b) => delete b.allocationRules, "allocationRules: must be a list"],
      ["allocationOverrides missing", (b) => delete b.allocationOverrides, "allocationOverrides: must be a list"],
      ["month start day 29", (b) => (b.settings.monthStartDay = 29), "settings.monthStartDay"],
      ["month start day fractional", (b) => (b.settings.monthStartDay = 1.5), "settings.monthStartDay"],
      ["row that is not an object", (b) => (b.accounts[0] = "x" as never), "accounts[0]: must be an object"],
    ]);
  });

  describe("bad field values", () => {
    rejects([
      ["account type outside the enum", (b) => (b.accounts[0].type = "crypto" as never), "accounts[0].type: must be one of"],
      ["category kind outside the enum", (b) => (b.categories[0].kind = "transfer" as never), "categories[0].kind"],
      ["transaction type outside the enum", (b) => (tx0(b).type = "REFUND" as never), "transactions[0].type"],
      ["status outside the enum", (b) => (tx0(b).status = "draft" as never), "transactions[0].status"],
      ["amount with a fraction", (b) => (tx0(b).amount = 12.5), "transactions[0].amount: must be a whole number of piasters"],
      ["amount as text", (b) => (tx0(b).amount = "100" as never), "transactions[0].amount"],
      ["opening balance beyond safe integers", (b) => (b.accounts[0].openingBalance = 2 ** 60), "accounts[0].openingBalance"],
      ["impossible calendar date", (b) => (tx0(b).date = "2026-02-30"), "transactions[0].date: must be a real date"],
      ["date in the wrong format", (b) => (tx0(b).date = "10/03/2026"), "transactions[0].date"],
      ["timestamp without a zone", (b) => (b.accounts[0].createdAt = "2026-03-01T08:00:00"), "accounts[0].createdAt"],
      ["id that is not a lowercase uuid", (b) => (b.accounts[0].id = b.accounts[0].id.toUpperCase().replace(/^0+/, "A")), "accounts[0].id: must be a lowercase uuid"],
      ["empty account name", (b) => (b.accounts[0].name = "  "), "accounts[0].name: must not be empty"],
      ["NUL character in a note", (b) => (tx0(b).note = "a\0b"), "transactions[0].note: must be text"],
      ["boolean given as text", (b) => (b.categories[0].isEssential = "yes" as never), "categories[0].isEssential"],
    ]);
  });

  describe("amount sign rules", () => {
    rejects([
      ["zero amount", (b) => (tx0(b).amount = 0), "never zero"],
      ["negative income", (b) => (tx0(b).amount = -1), "only ADJUSTMENT may be negative"],
      ["zero adjustment", (b) => (b.transactions[5].amount = 0), "never zero"],
      ["negative fee", (b) => (expense(b).fee = -1), "must not be negative"],
      ["negative tax withheld", (b) => (expense(b).taxWithheld = -1), "must not be negative"],
    ]);
  });

  describe("account presence by type", () => {
    rejects([
      ["INCOME with a from account", (b) => (tx0(b).fromAccountId = CASH), "INCOME needs toAccountId and no fromAccountId"],
      ["INCOME without a to account", (b) => (tx0(b).toAccountId = null), "INCOME needs toAccountId"],
      ["ADJUSTMENT with a from account", (b) => (b.transactions[5].fromAccountId = BANK), "ADJUSTMENT needs toAccountId"],
      ["EXPENSE without a from account", (b) => (expense(b).fromAccountId = null), "EXPENSE needs fromAccountId and no toAccountId"],
      ["EXPENSE with a to account", (b) => (expense(b).toAccountId = CASH), "EXPENSE needs fromAccountId"],
      ["INVESTMENT_PURCHASE with a to account", (b) => (b.transactions[6].toAccountId = CASH), "INVESTMENT_PURCHASE needs fromAccountId"],
      ["TRANSFER to the same account", (b) => (transfer(b).toAccountId = BANK), "TRANSFER needs two different accounts"],
      ["TRANSFER without a to account", (b) => (transfer(b).toAccountId = null), "TRANSFER needs two different accounts"],
    ]);
  });

  describe("references and duplicates", () => {
    rejects([
      ["unknown from account", (b) => (expense(b).fromAccountId = id(99)), "transactions[1].fromAccountId: refers to an account that is not in the file"],
      ["unknown to account", (b) => (tx0(b).toAccountId = id(99)), "transactions[0].toAccountId: refers to an account"],
      ["unknown category", (b) => (expense(b).categoryId = id(99)), "transactions[1].categoryId: refers to a category"],
      ["unknown replaced transaction", (b) => (b.transactions[3].replacesId = id(99)), "transactions[3].replacesId: refers to a transaction"],
      ["transaction replacing itself", (b) => (b.transactions[3].replacesId = id(104)), "replacesId links form a loop"],
      ["two transactions replacing each other", (b) => (b.transactions[2].replacesId = id(104)), "replacesId links form a loop"],
      ["duplicate account id", (b) => (b.accounts[1].id = BANK), "accounts.id: appears twice"],
      ["duplicate category id", (b) => (b.categories[1].id = FOOD), "categories.id: appears twice"],
      ["duplicate transaction id", (b) => (b.transactions[1].id = id(101)), "transactions.id: appears twice"],
      ["duplicate category kind and name", (b) => ((b.categories[1].name = "Food"), (b.categories[1].kind = "expense")), "categories (kind and name): appears twice"],
    ]);

    it("accepts the same category name under the other kind", () => {
      const b = valid();
      b.categories[1].name = "Food";
      expect(parseBackup(b).ok).toBe(true);
    });
  });
});

const goal0 = (b: Backup) => b.goals[0];
const alloc0 = (b: Backup) => b.goalAllocations[0];
const event0 = (b: Backup) => b.goalAllocationEvents[0];
const rule = (b: Backup, n: number) => b.allocationRules[n];
const override0 = (b: Backup) => b.allocationOverrides[0];

describe("parseBackup rejects (version 2 additions)", () => {
  describe("savings settings", () => {
    rejects([
      ["savings mode outside the enum", (b) => (b.settings.savingsTargetMode = "auto" as never), "settings.savingsTargetMode: must be one of"],
      ["savings mode missing", (b) => delete b.settings.savingsTargetMode, "settings.savingsTargetMode"],
      ["savings amount with a fraction", (b) => (b.settings.savingsTargetAmount = 1.5), "settings.savingsTargetAmount"],
      ["savings percent too large for the column", (b) => (b.settings.savingsTargetPercent = 100), "settings.savingsTargetPercent"],
      ["savings percent as text", (b) => (b.settings.savingsTargetPercent = "20%" as never), "settings.savingsTargetPercent"],
      ["expected income as text", (b) => (b.settings.expectedMonthlyIncome = "3000" as never), "settings.expectedMonthlyIncome"],
      ["expected spending missing", (b) => delete b.settings.expectedMonthlySpending, "settings.expectedMonthlySpending"],
    ]);
  });

  describe("goal values (goals_*_check)", () => {
    rejects([
      ["target amount zero", (b) => (goal0(b).targetAmount = 0), "goals[0].targetAmount: must be above zero"],
      ["target amount negative", (b) => (goal0(b).targetAmount = -5), "goals[0].targetAmount: must be above zero"],
      ["priority zero", (b) => (goal0(b).priority = 0), "goals[0].priority"],
      ["priority beyond an integer column", (b) => (goal0(b).priority = 2 ** 31), "goals[0].priority"],
      ["priority with a fraction", (b) => (goal0(b).priority = 1.5), "goals[0].priority"],
      ["planned monthly negative", (b) => (goal0(b).plannedMonthly = -1), "goals[0].plannedMonthly: must not be negative"],
      ["manual current negative", (b) => (goal0(b).manualCurrent = -1), "goals[0].manualCurrent: must not be negative"],
      ["expected return as text", (b) => (goal0(b).expectedReturnOverride = "12%" as never), "goals[0].expectedReturnOverride"],
      ["expected return too large for the column", (b) => (goal0(b).expectedReturnOverride = 100), "goals[0].expectedReturnOverride"],
      ["impossible target date", (b) => (goal0(b).targetDate = "2027-02-30"), "goals[0].targetDate: must be a real date"],
      ["bad start date", (b) => (goal0(b).startDate = "03/01/2026"), "goals[0].startDate"],
      ["empty goal name", (b) => (goal0(b).name = " "), "goals[0].name: must not be empty"],
      ["duplicate goal id", (b) => (b.goals[1].id = EMERGENCY), "goals.id: appears twice"],
    ]);
  });

  describe("allocations (goal_allocations_amount_check, unique goal and account)", () => {
    rejects([
      ["allocation of zero", (b) => (alloc0(b).amount = 0), "goalAllocations[0].amount: must be above zero"],
      ["negative allocation", (b) => (alloc0(b).amount = -100), "goalAllocations[0].amount: must be above zero"],
      ["allocation with a fraction", (b) => (alloc0(b).amount = 10.5), "goalAllocations[0].amount"],
      ["same goal and account twice", (b) => (b.goalAllocations[1].accountId = BANK), "goalAllocations (goal and account): appears twice"],
      ["duplicate allocation id", (b) => (b.goalAllocations[1].id = id(31)), "goalAllocations.id: appears twice"],
      ["unknown goal", (b) => (alloc0(b).goalId = id(99)), "goalAllocations[0].goalId: refers to a goal that is not in the file"],
      ["unknown account", (b) => (alloc0(b).accountId = id(99)), "goalAllocations[0].accountId: refers to an account that is not in the file"],
    ]);
  });

  describe("allocation events (goal_allocation_events_delta_check)", () => {
    rejects([
      ["delta zero", (b) => (event0(b).delta = 0), "goalAllocationEvents[0].delta: must not be zero"],
      ["delta with a fraction", (b) => (event0(b).delta = 0.5), "goalAllocationEvents[0].delta"],
      ["impossible date", (b) => (event0(b).date = "2026-02-30"), "goalAllocationEvents[0].date: must be a real date"],
      ["unknown goal", (b) => (event0(b).goalId = id(99)), "goalAllocationEvents[0].goalId: refers to a goal"],
      ["unknown account", (b) => (event0(b).accountId = id(99)), "goalAllocationEvents[0].accountId: refers to an account"],
      ["duplicate event id", (b) => (b.goalAllocationEvents[1].id = id(41)), "goalAllocationEvents.id: appears twice"],
    ]);

    it("accepts a negative delta (an allocation that was lowered)", () => {
      expect(valid().goalAllocationEvents[1].delta).toBe(-100_000);
      expect(parseBackup(valid()).ok).toBe(true);
    });
  });

  describe("allocation rules (allocation_rules_*_check, one remainder)", () => {
    rejects([
      ["rule kind outside the enum", (b) => (rule(b, 0).kind = "rest" as never), "allocationRules[0].kind: must be one of"],
      ["target kind outside the enum", (b) => (rule(b, 0).targetKind = "gold" as never), "allocationRules[0].targetKind"],
      ["goal target without a goal", (b) => (rule(b, 0).goalId = null), "goalId must be set exactly when targetKind is goal"],
      ["bucket target with a goal", (b) => (rule(b, 1).goalId = EMERGENCY), "goalId must be set exactly when targetKind is goal"],
      ["fixed rule without an amount", (b) => (rule(b, 0).amount = null), "a fixed rule needs an amount above zero and no percent"],
      ["fixed rule with amount zero", (b) => (rule(b, 0).amount = 0), "a fixed rule needs an amount above zero and no percent"],
      ["fixed rule with a percent", (b) => (rule(b, 0).percent = 0.1), "a fixed rule needs an amount above zero and no percent"],
      ["percentage rule without a percent", (b) => (rule(b, 1).percent = null), "a percentage rule needs a percent above 0 and up to 1"],
      ["percentage rule at zero", (b) => (rule(b, 1).percent = 0), "a percentage rule needs a percent above 0 and up to 1"],
      ["percentage rule above 100%", (b) => (rule(b, 1).percent = 1.5), "a percentage rule needs a percent above 0 and up to 1"],
      ["percentage rule with an amount", (b) => (rule(b, 1).amount = 100), "a percentage rule needs a percent above 0 and up to 1, and no amount"],
      ["remainder rule with an amount", (b) => (rule(b, 2).amount = 100), "a remainder rule has neither an amount nor a percent"],
      ["remainder rule with a percent", (b) => (rule(b, 2).percent = 0.5), "a remainder rule has neither an amount nor a percent"],
      [
        "two remainder rules",
        (b) => {
          Object.assign(rule(b, 0), { kind: "remainder", amount: null });
        },
        "allocationRules: at most one remainder rule is allowed",
      ],
      ["rule for an unknown goal", (b) => (rule(b, 0).goalId = id(99)), "allocationRules[0].goalId: refers to a goal that is not in the file"],
      ["duplicate rule id", (b) => (b.allocationRules[1].id = FIXED_RULE), "allocationRules.id: appears twice"],
    ]);

    it("accepts a percentage of exactly 100%", () => {
      const b = valid();
      rule(b, 1).percent = 1;
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("allocation overrides (month and amount checks, unique rule and month)", () => {
    rejects([
      ["month 13", (b) => (override0(b).month = "2026-13"), "allocationOverrides[0].month: must be a month like 2026-03"],
      ["month without a leading zero", (b) => (override0(b).month = "2026-4"), "allocationOverrides[0].month"],
      ["a full date instead of a month", (b) => (override0(b).month = "2026-04-01"), "allocationOverrides[0].month"],
      ["negative amount", (b) => (override0(b).amount = -1), "allocationOverrides[0].amount: must not be negative"],
      ["amount with a fraction", (b) => (override0(b).amount = 1.5), "allocationOverrides[0].amount"],
      ["override of an unknown rule", (b) => (override0(b).ruleId = id(99)), "allocationOverrides[0].ruleId: refers to a rule that is not in the file"],
      ["same rule and month twice", (b) => (b.allocationOverrides[1].month = "2026-04"), "allocationOverrides (rule and month): appears twice"],
      ["duplicate override id", (b) => (b.allocationOverrides[1].id = id(61)), "allocationOverrides.id: appears twice"],
    ]);

    it("accepts an override of zero (skip this rule for the month)", () => {
      expect(valid().allocationOverrides[0].amount).toBe(0);
      expect(parseBackup(valid()).ok).toBe(true);
    });
  });
});

describe("insertOrder", () => {
  it("puts every replaced row before the row that replaces it, deepest chains last", () => {
    const row = (n: number, replacesId: number | null) => ({ id: id(n), replacesId: replacesId === null ? null : id(replacesId) });
    const ordered = insertOrder([row(3, 2), row(2, 1), row(1, null), row(4, null)]);
    expect(ordered.map((r) => r.id)).toEqual([id(1), id(4), id(2), id(3)]);
  });
});

describe("transactionsToCsv", () => {
  const accountsById = new Map(rows.accounts.map((a) => [a.id, a]));
  const categoriesById = new Map(rows.categories.map((c) => [c.id, c]));
  const csv = (over: Record<string, unknown>[]) =>
    transactionsToCsv(over.map((o) => tx(1, o)), accountsById, categoriesById).split("\r\n");

  it("writes the header, EGP with two decimals, signed adjustments, and names instead of ids", () => {
    const lines = transactionsToCsv(rows.transactions, accountsById, categoriesById).split("\r\n");
    expect(lines[0]).toBe("date,type,amount,from_account,to_account,category,note,status");
    expect(lines[1]).toBe("2026-03-10,INCOME,30000.00,,CIB,Salary,,posted");
    expect(lines[2]).toBe("2026-03-10,EXPENSE,450.50,CIB,,Food,lunch,posted");
    expect(lines[4]).toBe("2026-03-10,EXPENSE,120.00,Visa,,Food,,posted");
    expect(lines[5]).toBe("2026-03-10,TRANSFER,5000.00,CIB,Cash,,,posted");
    expect(lines[6]).toBe("2026-03-10,ADJUSTMENT,-75.00,,Cash,,,posted");
    expect(lines[3]).toContain(",void");
    expect(lines.at(-1)).toBe("");
  });

  it.each([
    ["comma", "a,b", '"a,b"'],
    ["quote", 'say "hi"', '"say ""hi"""'],
    ["newline", "a\nb", '"a\nb"'],
    ["carriage return", "a\rb", '"a\rb"'],
    ["plain text", "lunch", "lunch"],
    ["Arabic text", "غداء", "غداء"],
  ])("quotes %s", (_name, note, cell) => {
    expect(transactionsToCsv([tx(1, { note })], accountsById, categoriesById)).toContain(`,${cell},posted\r\n`);
  });

  it.each([
    ["=", "=HYPERLINK(\"http://x\")", `"'=HYPERLINK(""http://x"")"`],
    ["+", "+1+1", "'+1+1"],
    ["-", "-2", "'-2"],
    ["@", "@SUM(A1)", "'@SUM(A1)"],
    ["tab", "\t=1", "'\t=1"],
    ["a minus inside the text", "a-b", "a-b"],
  ])("neutralises a note starting with %s", (_name, note, cell) => {
    expect(transactionsToCsv([tx(1, { note })], accountsById, categoriesById)).toContain(`,${cell},posted\r\n`);
  });

  it("guards account and category names too, but leaves a negative amount as a number", () => {
    const evil = new Map([[BANK, { name: "=cmd|' /C calc'!A0" }]]);
    const cats = new Map([[FOOD, { name: "@x" }]]);
    const [, line] = transactionsToCsv(
      [tx(1, { type: "ADJUSTMENT", amount: -5, toAccountId: BANK, categoryId: FOOD })],
      evil,
      cats,
    ).split("\r\n");
    expect(line).toBe("2026-03-10,ADJUSTMENT,-0.05,,'=cmd|' /C calc'!A0,'@x,,posted");
    expect(csv([{ amount: 5 }])[1]).toContain(",0.05,");
  });
});
