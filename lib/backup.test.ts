import { describe, expect, it } from "vitest";
import {
  accountType,
  allocationRuleKind,
  allocationTargetKind,
  categoryKind,
  contributionFrequency,
  corporateActionKind,
  goalTargetMode,
  goldForm,
  goldPriceMode,
  holdingKind,
  liabilityKind,
  recurringFrequency,
  savingsTargetMode,
  transactionStatus,
  transactionType,
} from "../db/schema";
import {
  ACCOUNT_TYPES,
  BACKUP_VERSION,
  CATEGORY_KINDS,
  CONTRIBUTION_FREQUENCIES,
  CORPORATE_ACTION_KINDS,
  eventsByHolding,
  GOAL_TARGET_MODES,
  GOLD_FORMS,
  GOLD_PRICE_MODES,
  HOLDING_KINDS,
  insertOrder,
  LIABILITY_KINDS,
  parseBackup,
  RECURRING_FREQUENCIES,
  RULE_KINDS,
  SAVINGS_MODES,
  serializeBackup,
  TARGET_KINDS,
  toHoldingEvents,
  transactionsToCsv,
  TX_STATUSES,
  TX_TYPES,
  type Backup,
  type BackupRows,
} from "./backup";
import type { loadBackupRows } from "../db/queries";
import { cloudLine } from "./finance-core/clouds";
import { goldPricesFor, type Karat } from "./finance-core/gold";
import { accountBalance, netWorth, type Tx } from "./finance-core/ledger";
import { outstanding } from "./finance-core/liabilities";
import { portfolioValue, replayHolding } from "./finance-core/portfolio";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BANK = id(1);
const CASH = id(2);
const CARD = id(3);
const THNDR = id(4);
const COMI = id(70); // a stock
const GOLD_FUND = id(71); // a fund
const GOLD = id(72); // physical gold, 21K bar
const CLOUD = id(73); // a Savings Cloud
const LOAN = id(60);
const FOOD = id(11);
const SALARY = id(12);
const LOAN_INTEREST = id(13);
const TRIP = id(22);
const EMERGENCY = id(21);
const RETAINER = id(150); // an auto-posted monthly income template
const MEAL_PLAN = id(151); // a paused weekly expense template
const FIXED_RULE = id(51);
const at = (s: string) => new Date(s);
type GoldForm = "bar" | "coin" | "jewelry";
// Every holding row carries the gold and cloud columns; a stock or fund leaves them null.
const noGoldOrCloud = {
  karat: null as number | null,
  form: null as GoldForm | null,
  startDate: null as string | null,
  maturityDate: null as string | null,
  contributionAmount: null as number | null,
  contributionFrequency: null as "weekly" | "monthly" | null,
};
const noHolding = { holdingId: null as string | null, percent: null as string | null };
const noShare = { holdingId: null as string | null, percentDelta: null as string | null };

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
    staleDaysHoldings: 14,
    goldPriceMode: "per_karat" as "derive_24k" | "per_karat",
    staleDaysGold: 10,
    staleDaysClouds: 45,
    budgetWarnAt: "0.750" as string | number, // numeric columns arrive as text
    budgetAlertAt: "1.000" as string | number,
    targetStocks: "0.40000" as string | null, // numeric columns arrive as text
    targetGold: "0.10000" as string | null,
    targetClouds: "0.20000" as string | null,
    targetCash: "0.30000" as string | null,
    insightMinPercent: "0.2000" as string | number,
    insightMinAmount: 75_000,
    remindReview: true,
    remindRecurring: false,
    remindStale: true,
    remindGoal: true,
    remindBudget: false,
    remindSavings: true,
  },
  accounts: [
    { ...base, id: BANK, name: "CIB", type: "bank" as const, institution: "CIB", notes: null, isInvestment: false, openingBalance: 5_000_000, archivedAt: null, updatedAt: at("2026-03-02T08:00:00.000Z") },
    { ...base, id: CASH, name: "Cash", type: "cash" as const, institution: null, notes: "wallet, \"left\"", isInvestment: false, openingBalance: 0, archivedAt: at("2026-04-01T00:00:00.000Z"), updatedAt: base.createdAt },
    { ...base, id: CARD, name: "Visa", type: "credit_card" as const, institution: null, notes: null, isInvestment: false, openingBalance: -120_000, archivedAt: null, updatedAt: base.createdAt },
    { ...base, id: THNDR, name: "Thndr", type: "brokerage" as const, institution: "Thndr", notes: null, isInvestment: true, openingBalance: 0, archivedAt: null, updatedAt: base.createdAt },
  ],
  categories: [
    { ...base, id: FOOD, name: "Food", kind: "expense" as const, isEssential: true, archivedAt: null },
    { ...base, id: SALARY, name: "Salary", kind: "income" as const, isEssential: false, archivedAt: null },
    { ...base, id: LOAN_INTEREST, name: "Loan interest", kind: "expense" as const, isEssential: true, archivedAt: null },
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
    // COMI: buy 100 @ 10.50 + 1.50 fee (basis 1,051.50), +10 bonus on 03-10, sell 40 @ 12 (fee 1.00, tax 0.50), dividend 200 gross, 20 tax.
    tx(108, { type: "INVESTMENT_PURCHASE", date: "2026-03-01", amount: 105_150, fromAccountId: BANK, fee: 150, holdingId: COMI, quantity: "100.000000", unitPrice: "10.500000" }),
    tx(109, { type: "INVESTMENT_SALE", date: "2026-03-20", amount: 47_850, toAccountId: THNDR, fee: 100, taxWithheld: 50, grossAmount: 48_000, holdingId: COMI, quantity: "40.000000", unitPrice: "12.000000" }),
    tx(110, { type: "DIVIDEND", date: "2026-03-25", amount: 18_000, toAccountId: THNDR, grossAmount: 20_000, taxWithheld: 2_000, holdingId: COMI }),
    // GOLD_FUND: a mistaken buy of 5 was voided; the real buy of 10 @ 50 follows, then a 2-for-1 split on 03-15.
    tx(111, { type: "INVESTMENT_PURCHASE", date: "2026-03-02", amount: 25_000, fromAccountId: BANK, holdingId: GOLD_FUND, quantity: "5.000000", unitPrice: "50.000000", status: "void", voidedAt: at("2026-03-03T10:00:00.000Z") }),
    tx(112, { type: "INVESTMENT_PURCHASE", date: "2026-03-03", amount: 50_000, fromAccountId: BANK, holdingId: GOLD_FUND, quantity: "10.000000", unitPrice: "50.000000", createdAt: at("2026-03-03T10:00:00.000Z") }),
    // GOLD: 10 g of 21K at a metal price of 4,000 per gram plus 50.00 workmanship, which is the fee and goes into cost basis.
    tx(113, { type: "INVESTMENT_PURCHASE", date: "2026-03-05", amount: 4_005_000, fromAccountId: BANK, fee: 5_000, holdingId: GOLD, quantity: "10.000000", unitPrice: "4000.000000" }),
    // CLOUD: deposit 10,000.00 (then confirmed at that value), deposit 5,000.00 on 03-15, withdraw 2,000.00 on 03-20. No quantity, no price.
    tx(114, { type: "INVESTMENT_PURCHASE", date: "2026-03-01", amount: 1_000_000, fromAccountId: BANK, holdingId: CLOUD, createdAt: at("2026-03-01T10:00:00.000Z") }),
    tx(115, { type: "INVESTMENT_PURCHASE", date: "2026-03-15", amount: 500_000, fromAccountId: BANK, holdingId: CLOUD }),
    tx(116, { type: "INVESTMENT_SALE", date: "2026-03-20", amount: 200_000, toAccountId: BANK, holdingId: CLOUD }),
    // One loan payment: principal 3,000.00 and interest 120.00, written together with the same createdAt.
    tx(117, { type: "LIABILITY_PAYMENT", date: "2026-03-18", amount: 300_000, fromAccountId: BANK, liabilityId: LOAN, createdAt: at("2026-03-18T09:00:00.000Z") }),
    tx(118, { type: "EXPENSE", date: "2026-03-18", amount: 12_000, fromAccountId: BANK, categoryId: LOAN_INTEREST, liabilityId: LOAN, createdAt: at("2026-03-18T09:00:00.000Z") }),
    // Generated from templates: an auto-posted income, a pending expense, and a skipped (void) one whose due date stays taken.
    tx(119, { type: "INCOME", date: "2026-03-05", amount: 100_000, toAccountId: BANK, categoryId: SALARY, note: "Retainer", recurringTemplateId: RETAINER, recurringDueDate: "2026-03-05" }),
    tx(120, { type: "EXPENSE", date: "2026-03-15", amount: 20_000, fromAccountId: BANK, categoryId: FOOD, status: "pending", note: "Meal plan", recurringTemplateId: MEAL_PLAN, recurringDueDate: "2026-03-15" }),
    tx(121, { type: "EXPENSE", date: "2026-03-08", amount: 20_000, fromAccountId: BANK, categoryId: FOOD, status: "void", voidedAt: at("2026-03-09T10:00:00.000Z"), note: "Meal plan", recurringTemplateId: MEAL_PLAN, recurringDueDate: "2026-03-08" }),
  ],
  budgets: [
    { ...base, id: id(141), categoryId: null as string | null, amount: 2_000_000, updatedAt: at("2026-03-02T08:00:00.000Z") },
    { ...base, id: id(142), categoryId: FOOD as string | null, amount: 500_000, updatedAt: base.createdAt },
  ],
  recurringTemplates: [
    { ...base, id: RETAINER, name: "Retainer", type: "INCOME" as "INCOME" | "EXPENSE", amount: 100_000, categoryId: SALARY as string | null, accountId: BANK, frequency: "monthly" as "weekly" | "monthly" | "yearly", startDate: "2026-01-05", endDate: null as string | null, autoPost: true, active: true, note: null as string | null, updatedAt: base.createdAt },
    { ...base, id: MEAL_PLAN, name: "Meal plan", type: "EXPENSE" as "INCOME" | "EXPENSE", amount: 20_000, categoryId: FOOD as string | null, accountId: BANK, frequency: "weekly" as "weekly" | "monthly" | "yearly", startDate: "2026-03-01", endDate: "2026-12-31" as string | null, autoPost: false, active: false, note: "paused for Ramadan" as string | null, updatedAt: at("2026-03-20T08:00:00.000Z") },
  ],
  holdings: [
    { ...base, ...noGoldOrCloud, id: COMI, accountId: THNDR, kind: "stock" as const, name: "Commercial International Bank", ticker: "COMI", notes: null as string | null, archivedAt: null as Date | null, updatedAt: base.createdAt },
    { ...base, ...noGoldOrCloud, id: GOLD_FUND, accountId: THNDR, kind: "fund" as const, name: "Gold fund", ticker: null as string | null, notes: "bought on Thndr", archivedAt: null, updatedAt: base.createdAt },
    { ...base, ...noGoldOrCloud, id: GOLD, accountId: THNDR, kind: "gold" as "gold" | "stock", name: "Gold bar", ticker: null, notes: null, karat: 21 as number | null, form: "bar" as GoldForm | null, archivedAt: null, updatedAt: base.createdAt },
    { ...base, ...noGoldOrCloud, id: CLOUD, accountId: THNDR, kind: "cloud" as "cloud" | "stock", name: "Savings Cloud", ticker: null, notes: null, startDate: "2026-03-01" as string | null, maturityDate: "2027-03-01" as string | null, contributionAmount: 100_000 as number | null, contributionFrequency: "monthly" as "weekly" | "monthly" | null, archivedAt: null, updatedAt: base.createdAt },
  ],
  // Gold is valued from these buy-back prices (per_karat mode: each karat has its own); 21K bought at 4,000 now buys back at 4,550.50.
  goldPrices: [
    { ...base, id: id(101), date: "2026-03-05", karat: 21, buybackPrice: "4400.000000" },
    { ...base, id: id(102), date: "2026-03-28", karat: 21, buybackPrice: "4550.500000" },
    { ...base, id: id(103), date: "2026-03-28", karat: 24, buybackPrice: "5200.000000" },
  ],
  rateHistory: [
    { ...base, id: id(111), holdingId: CLOUD, effectiveDate: "2026-03-01", apy: "0.200000" as string | number },
    { ...base, id: id(112), holdingId: CLOUD, effectiveDate: "2026-03-25", apy: "0.150000" as string | number },
  ],
  cloudConfirmations: [{ ...base, id: id(121), holdingId: CLOUD, date: "2026-03-01", value: 1_000_000, createdAt: at("2026-03-01T11:00:00.000Z") }],
  liabilities: [
    { ...base, id: LOAN, name: "Car loan", kind: "loan" as "loan" | "owed" | "other", openingBalance: 1_000_000, interestRate: "0.180000" as string | null, startDate: "2026-03-01", notes: null as string | null, archivedAt: null as Date | null, updatedAt: base.createdAt },
  ],
  liabilityUpdates: [
    { ...base, id: id(131), liabilityId: LOAN, date: "2026-03-10", delta: 500_000, note: "borrowed more" as string | null },
    { ...base, id: id(132), liabilityId: LOAN, date: "2026-03-20", delta: -50_000, note: null },
  ],
  priceUpdates: [
    { ...base, id: id(81), holdingId: COMI, date: "2026-03-22", price: "11.250000" },
    { ...base, id: id(82), holdingId: COMI, date: "2026-03-28", price: "12.000000" },
    { ...base, id: id(83), holdingId: GOLD_FUND, date: "2026-03-28", price: "27.500000" },
  ],
  corporateActions: [
    { ...base, id: id(91), holdingId: COMI, kind: "BONUS" as "BONUS" | "SPLIT" | "WRITE_OFF", date: "2026-03-10", quantity: "10.000000" as string | null, ratio: null as string | null, note: "1 for 10 bonus" as string | null },
    { ...base, id: id(92), holdingId: GOLD_FUND, kind: "SPLIT" as const, date: "2026-03-15", quantity: null, ratio: "2.000000", note: null },
  ],
  assumptions: { stockReturn: "0.150000" as string | null, goldReturn: null as string | null, savingsCloudApy: "0.120000" as string | null, cashReturn: null as string | null, inflation: "0.250000" as string | null, incomeGrowth: "0.050000" as string | null },
  goals: [
    { ...base, id: EMERGENCY, name: "Emergency fund", targetAmount: 10_000_000, targetMode: "expense_months" as "manual" | "expense_months", targetMonths: 6 as number | null, targetDate: "2027-12-31", startDate: "2026-03-01", priority: 1, plannedMonthly: 500_000 as number | null, expectedReturnOverride: "0.120000" as string | null, manualCurrent: null as number | null, notes: "six months", color: "#22aa77", icon: "shield", archivedAt: null as Date | null, updatedAt: at("2026-03-05T08:00:00.000Z") },
    { ...base, id: TRIP, name: "Trip", targetAmount: 2_000_000, targetMode: "manual" as const, targetMonths: null, targetDate: "2026-12-01", startDate: "2026-03-01", priority: 2, plannedMonthly: null, expectedReturnOverride: null, manualCurrent: 150_000, notes: null, color: null, icon: null, archivedAt: at("2026-06-01T00:00:00.000Z"), updatedAt: base.createdAt },
  ],
  goalAllocations: [
    { ...base, ...noHolding, id: id(31), goalId: EMERGENCY, accountId: BANK as string | null, amount: 800_000 as number | null, updatedAt: at("2026-03-12T08:00:00.000Z") },
    { ...base, ...noHolding, id: id(32), goalId: EMERGENCY, accountId: CASH as string | null, amount: 100_000 as number | null, updatedAt: base.createdAt },
    // Two goals share the cloud, 25% and 75%: exactly all of it.
    { ...base, id: id(33), goalId: EMERGENCY, accountId: null as string | null, amount: null as number | null, holdingId: CLOUD as string | null, percent: "0.250000" as string | null, updatedAt: base.createdAt },
    { ...base, id: id(34), goalId: TRIP, accountId: null as string | null, amount: null as number | null, holdingId: CLOUD as string | null, percent: "0.750000" as string | null, updatedAt: base.createdAt },
  ],
  goalAllocationEvents: [
    { ...base, ...noShare, id: id(41), goalId: EMERGENCY, accountId: BANK as string | null, delta: 900_000, date: "2026-03-10", note: null as string | null },
    { ...base, ...noShare, id: id(42), goalId: EMERGENCY, accountId: BANK as string | null, delta: -100_000, date: "2026-03-12", note: "moved to cash" },
    { ...base, ...noShare, id: id(43), goalId: EMERGENCY, accountId: CASH as string | null, delta: 100_000, date: "2026-03-12", note: null },
    // The EGP value of the share at that moment, so later growth is never counted as a contribution.
    { ...base, id: id(44), goalId: EMERGENCY, accountId: null as string | null, holdingId: CLOUD as string | null, percentDelta: "0.250000" as string | null, delta: 375_000, date: "2026-03-26", note: null },
    { ...base, id: id(45), goalId: TRIP, accountId: null as string | null, holdingId: CLOUD as string | null, percentDelta: "0.750000" as string | null, delta: 1_125_000, date: "2026-03-26", note: null },
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
    type: "EXPENSE" as "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT" | "INVESTMENT_PURCHASE" | "INVESTMENT_SALE" | "LIABILITY_PAYMENT" | "DIVIDEND",
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
    holdingId: null as string | null,
    quantity: null as string | null,
    unitPrice: null as string | null,
    liabilityId: null as string | null,
    replacesId: null as string | null,
    recurringTemplateId: null as string | null,
    recurringDueDate: null as string | null,
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
    expect([ACCOUNT_TYPES, CATEGORY_KINDS, TX_TYPES, TX_STATUSES, SAVINGS_MODES, RULE_KINDS, TARGET_KINDS, HOLDING_KINDS, CORPORATE_ACTION_KINDS, GOLD_FORMS, CONTRIBUTION_FREQUENCIES, GOLD_PRICE_MODES, LIABILITY_KINDS, RECURRING_FREQUENCIES, GOAL_TARGET_MODES]).toEqual([
      accountType.enumValues,
      categoryKind.enumValues,
      transactionType.enumValues,
      transactionStatus.enumValues,
      savingsTargetMode.enumValues,
      allocationRuleKind.enumValues,
      allocationTargetKind.enumValues,
      holdingKind.enumValues,
      corporateActionKind.enumValues,
      goldForm.enumValues,
      contributionFrequency.enumValues,
      goldPriceMode.enumValues,
      liabilityKind.enumValues,
      recurringFrequency.enumValues,
      goalTargetMode.enumValues,
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
    expect(before).toEqual({
      // salary + retainer - lunch - transfer - COMI buy - fund buy - gold buy - 2 cloud deposits + cloud withdrawal - loan principal - loan interest
      // (the pending and skipped meal-plan rows move nothing)
      [BANK]: 5_000_000 + 3_000_000 + 100_000 - 45_050 - 500_000 - 105_150 - 50_000 - 4_005_000 - 1_000_000 - 500_000 + 200_000 - 300_000 - 12_000,
      [CASH]: 500_000 - 7_500,
      [CARD]: -120_000 - 12_000,
      [THNDR]: 47_850 + 18_000,
    });
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
      staleDaysHoldings: 14,
      goldPriceMode: "per_karat",
      staleDaysGold: 10,
      staleDaysClouds: 45,
      budgetWarnAt: 0.75,
      budgetAlertAt: 1,
      targetStocks: 0.4,
      targetGold: 0.1,
      targetClouds: 0.2,
      targetCash: 0.3,
      insightMinPercent: 0.2,
      insightMinAmount: 75_000,
      remindReview: true,
      remindRecurring: false,
      remindStale: true,
      remindGoal: true,
      remindBudget: false,
      remindSavings: true,
    });
    expect(backup.goals.map((g) => g.expectedReturnOverride)).toEqual([0.12, null]);
    expect(backup.allocationRules.map((r) => r.percent)).toEqual([null, 0.25, null]);

    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed).toEqual({ ok: true, backup });
    expect([backup.goals.length, backup.goalAllocations.length, backup.goalAllocationEvents.length]).toEqual([2, 4, 5]);
    expect([backup.allocationRules.length, backup.allocationOverrides.length]).toEqual([3, 2]);
  });
});

const HOLDING_KEYS = ["holdings", "priceUpdates", "corporateActions", "assumptions"];

describe("round trip of holdings", () => {
  const positions = (b: { transactions: Backup["transactions"]; holdings: { id: string }[]; corporateActions: Backup["corporateActions"] }) => {
    const events = eventsByHolding(toHoldingEvents(b.transactions, b.corporateActions));
    return Object.fromEntries(b.holdings.map((h) => [h.id, replayHolding(events.get(h.id) ?? [])]));
  };

  it("keeps holdings, price updates, corporate actions, assumptions and stale days, with decimals as strings and rates as numbers", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    expect(backup.priceUpdates.map((p) => p.price)).toEqual(["11.250000", "12.000000", "27.500000"]);
    expect(backup.transactions[7]).toMatchObject({ holdingId: COMI, quantity: "100.000000", unitPrice: "10.500000" });
    expect(backup.corporateActions.map((c) => [c.kind, c.quantity, c.ratio])).toEqual([
      ["BONUS", "10.000000", null],
      ["SPLIT", null, "2.000000"],
    ]);
    expect(backup.assumptions).toEqual({ stockReturn: 0.15, goldReturn: null, savingsCloudApy: 0.12, cashReturn: null, inflation: 0.25, incomeGrowth: 0.05 });
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup });
  });

  it("replays to equal positions before and after, ignoring the voided purchase", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const before = positions(backup);
    expect(positions(parsed.backup)).toEqual(before);
    // COMI: (100 + 10 bonus - 40) units; GOLD_FUND: 10 units doubled by the split.
    expect([before[COMI].quantity, before[GOLD_FUND].quantity]).toEqual(["70", "20"]);
    expect(before[COMI].costBasis).toBe(105_150 - 38_236); // sold 40 of 110 units at average cost
    expect(before[GOLD_FUND].costBasis).toBe(50_000);
    expect(before[COMI].dividendsNet).toBe(18_000);
  });
});

describe("round trip of gold, clouds, loans and holding shares (version 4)", () => {
  // Net worth as the engines compute it from a backup: cash + stocks/funds + gold + clouds - liabilities.
  const wealth = (b: Backup, today: string) => {
    const events = eventsByHolding(toHoldingEvents(b.transactions, b.corporateActions));
    const goldPrices = b.goldPrices.map((p) => ({ date: p.date, karat: p.karat as Karat, price: p.buybackPrice, createdAt: p.createdAt }));
    const units = b.holdings
      .filter((h) => h.kind !== "cloud")
      .map((h) => ({
        id: h.id,
        events: events.get(h.id) ?? [],
        priceUpdates:
          h.kind === "gold"
            ? goldPricesFor(goldPrices, h.karat as Karat, b.settings.goldPriceMode)
            : b.priceUpdates.filter((p) => p.holdingId === h.id),
      }));
    const clouds = b.holdings
      .filter((h) => h.kind === "cloud")
      .map((h) =>
        cloudLine({
          id: h.id,
          confirmations: b.cloudConfirmations.filter((c) => c.holdingId === h.id).map((c) => ({ date: c.date, createdAt: c.createdAt, value: c.value })),
          cashFlows: b.transactions
            .filter((t) => t.holdingId === h.id && t.status === "posted")
            .map((t) => ({ date: t.date, createdAt: t.createdAt, kind: t.type === "INVESTMENT_PURCHASE" ? ("deposit" as const) : ("withdrawal" as const), amount: t.amount })),
          rates: b.rateHistory.filter((r) => r.holdingId === h.id).map((r) => ({ date: r.effectiveDate, createdAt: r.createdAt, apy: r.apy })),
          today,
        }),
      );
    const portfolio = portfolioValue(units, today, b.settings.staleDaysHoldings, clouds);
    const cash = Object.values(balances(b)).reduce((sum, v) => sum + v, 0);
    const liabilities = b.liabilities.reduce(
      (sum, l) =>
        sum +
        outstanding(
          l.openingBalance,
          b.liabilityUpdates.filter((u) => u.liabilityId === l.id),
          b.transactions.filter((t) => t.type === "LIABILITY_PAYMENT" && t.status === "posted" && t.liabilityId === l.id),
        ),
      0,
    );
    return { cash, portfolio: portfolio.total, gold: portfolio.lines.find((l) => l.id === GOLD)!.value, cloud: clouds[0].value, liabilities, netWorth: netWorth({ cash, holdings: portfolio.total, liabilities }) };
  };

  it("keeps every new table and column, with decimals as strings and rates as numbers", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    expect(backup.goldPrices.map((p) => [p.karat, p.buybackPrice])).toEqual([[21, "4400.000000"], [21, "4550.500000"], [24, "5200.000000"]]);
    expect(backup.rateHistory.map((r) => r.apy)).toEqual([0.2, 0.15]);
    expect(backup.cloudConfirmations[0]).toMatchObject({ holdingId: CLOUD, value: 1_000_000 });
    expect(backup.liabilities[0]).toMatchObject({ openingBalance: 1_000_000, interestRate: 0.18, kind: "loan" });
    expect(backup.liabilityUpdates.map((u) => u.delta)).toEqual([500_000, -50_000]);
    expect(backup.holdings.slice(2).map((h) => [h.kind, h.karat, h.form, h.startDate, h.contributionAmount, h.contributionFrequency])).toEqual([
      ["gold", 21, "bar", null, null, null],
      ["cloud", null, null, "2026-03-01", 100_000, "monthly"],
    ]);
    expect(backup.goalAllocations.slice(2).map((a) => [a.accountId, a.amount, a.holdingId, a.percent])).toEqual([
      [null, null, CLOUD, 0.25],
      [null, null, CLOUD, 0.75],
    ]);
    expect(backup.goalAllocationEvents.slice(3).map((e) => [e.accountId, e.holdingId, e.percentDelta, e.delta])).toEqual([
      [null, CLOUD, 0.25, 375_000],
      [null, CLOUD, 0.75, 1_125_000],
    ]);
    expect(backup.transactions[16]).toMatchObject({ type: "LIABILITY_PAYMENT", liabilityId: LOAN });
    expect(backup.transactions[13]).toMatchObject({ holdingId: CLOUD, quantity: null, unitPrice: null });
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup });
  });

  it("restores to the same net worth: gold at buy-back, the cloud estimate and the loan balance", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const before = wealth(backup, "2026-04-30");
    expect(wealth(parsed.backup, "2026-04-30")).toEqual(before);
    expect(before.gold).toBe(4_550_500); // 10 g x 4,550.50 buy-back, not the 4,000 paid
    expect(before.liabilities).toBe(1_000_000 + 500_000 - 50_000 - 300_000);
    expect(before.cloud).toBeGreaterThan(1_000_000); // grown from the confirmed 10,000.00 at 20% then 15%
    expect(before.netWorth).toBe(before.cash + before.portfolio - before.liabilities);
  });

  it("does not treat a cloud deposit as a unit purchase", () => {
    const events = eventsByHolding(toHoldingEvents(serializeBackup(rows, EXPORTED_AT).transactions, []));
    expect(events.has(CLOUD)).toBe(false);
    expect(events.get(GOLD)).toHaveLength(1);
  });
});

// What the older app versions wrote: v1 has no goals, rules or savings settings; v2 adds them but has no holdings.
// v3 files have no gold, clouds, liabilities or holding shares: drop them and the columns they added.
// v4 files have no budgets, recurring templates, expense-based goal targets or budget thresholds.
// v5 files have no portfolio targets, insight thresholds, reminder switches or income growth.
const V6_SETTINGS = [
  "targetStocks", "targetGold", "targetClouds", "targetCash", "insightMinPercent", "insightMinAmount",
  "remindReview", "remindRecurring", "remindStale", "remindGoal", "remindBudget", "remindSavings",
];
const stripV6 = (b: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const key of V6_SETTINGS) delete b.settings[key];
  delete b.assumptions.incomeGrowth;
};

const stripV5 = (b: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  stripV6(b);
  for (const key of ["budgets", "recurringTemplates"]) delete b[key];
  for (const key of ["budgetWarnAt", "budgetAlertAt"]) delete b.settings[key];
  for (const g of b.goals) for (const key of ["targetMode", "targetMonths"]) delete g[key];
  for (const t of b.transactions) for (const key of ["recurringTemplateId", "recurringDueDate"]) delete t[key];
};

const stripV4 = (b: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  stripV5(b);
  for (const key of ["goldPrices", "rateHistory", "cloudConfirmations", "liabilities", "liabilityUpdates"]) delete b[key];
  for (const key of ["goldPriceMode", "staleDaysGold", "staleDaysClouds"]) delete b.settings[key];
  const dropped = new Set(b.holdings.filter((h: any) => h.kind === "gold" || h.kind === "cloud").map((h: any) => h.id)); // eslint-disable-line @typescript-eslint/no-explicit-any
  b.holdings = b.holdings.filter((h: any) => !dropped.has(h.id)); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const h of b.holdings) for (const key of ["karat", "form", "startDate", "maturityDate", "contributionAmount", "contributionFrequency"]) delete h[key];
  b.transactions = b.transactions.filter((t: any) => !dropped.has(t.holdingId) && t.liabilityId === null); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const t of b.transactions) delete t.liabilityId;
  b.goalAllocations = b.goalAllocations.filter((a: any) => a.holdingId === null); // eslint-disable-line @typescript-eslint/no-explicit-any
  b.goalAllocationEvents = b.goalAllocationEvents.filter((e: any) => e.holdingId === null); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const row of [...b.goalAllocations, ...b.goalAllocationEvents]) for (const key of ["holdingId", "percent", "percentDelta"]) delete row[key];
};

const stripHoldings = (b: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  stripV4(b);
  for (const key of HOLDING_KEYS) delete b[key];
  b.transactions = b.transactions.filter((t: any) => t.holdingId === null); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const t of b.transactions) for (const key of ["holdingId", "quantity", "unitPrice"]) delete t[key];
  delete b.settings.staleDaysHoldings;
};

describe("version 3 files", () => {
  const v3 = () => {
    const b: any = valid(); // eslint-disable-line @typescript-eslint/no-explicit-any
    stripV4(b);
    b.version = 3;
    return b;
  };

  it("still restore, with the new collections empty, the new columns null and the default gold and cloud settings", () => {
    const file = v3();
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const b = parsed.backup;
    expect(b.version).toBe(BACKUP_VERSION);
    expect([b.goldPrices, b.rateHistory, b.cloudConfirmations, b.liabilities, b.liabilityUpdates]).toEqual([[], [], [], [], []]);
    expect(b.settings).toMatchObject({ goldPriceMode: "derive_24k", staleDaysGold: 14, staleDaysClouds: 30, staleDaysHoldings: 14 });
    expect(b.holdings.map((h) => h.kind)).toEqual(["stock", "fund"]);
    expect(b.holdings.every((h) => h.karat === null && h.form === null && h.startDate === null && h.contributionAmount === null)).toBe(true);
    expect(b.transactions.every((t) => t.liabilityId === null)).toBe(true);
    expect(b.goalAllocations.every((a) => a.accountId !== null && a.holdingId === null && a.percent === null)).toBe(true);
    expect(b.goalAllocationEvents.every((e) => e.accountId !== null && e.holdingId === null && e.percentDelta === null)).toBe(true);
    expect(balances(b)).toEqual(balances(file));
  });

  it("are still validated like before: a cash allocation needs an account and a trade needs a quantity", () => {
    const file = v3();
    file.goalAllocations[0].accountId = null;
    expect(parseBackup(file)).toMatchObject({ ok: false });
    const other = v3();
    other.transactions[7].quantity = null;
    expect(parseBackup(other)).toMatchObject({ ok: false });
  });

  it("ignore new-format fields they should not have", () => {
    const file = v3();
    file.holdings[0].karat = 24;
    file.transactions[0].liabilityId = id(99);
    file.settings.goldPriceMode = "auto";
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect([parsed.backup.holdings[0].karat, parsed.backup.settings.goldPriceMode]).toEqual([null, "derive_24k"]);
  });
});

describe("version 2 files", () => {
  const v2 = () => {
    const b: any = valid(); // eslint-disable-line @typescript-eslint/no-explicit-any
    stripHoldings(b);
    b.version = 2;
    return b;
  };

  it("still restore, with no holdings, no assumptions and the default stale days", () => {
    const file = v2();
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const b = parsed.backup;
    expect(b.version).toBe(BACKUP_VERSION);
    expect([b.holdings, b.priceUpdates, b.corporateActions]).toEqual([[], [], []]);
    expect(b.assumptions).toEqual({ stockReturn: null, goldReturn: null, savingsCloudApy: null, cashReturn: null, inflation: null, incomeGrowth: null });
    expect(b.settings.staleDaysHoldings).toBe(7);
    expect(b.settings.savingsTargetMode).toBe("percentage");
    expect(b.goals).toHaveLength(2);
    expect(b.transactions.every((t) => t.holdingId === null && t.quantity === null && t.unitPrice === null)).toBe(true);
    expect(balances(b)).toEqual(balances(file));
  });

  it("are still validated like before", () => {
    const file = v2();
    file.goals[0].targetAmount = 0;
    expect(parseBackup(file)).toMatchObject({ ok: false });
  });

  it("ignore new-format fields they should not have", () => {
    const file = v2();
    file.transactions[0].holdingId = id(99);
    expect(parseBackup(file).ok).toBe(true);
  });
});

describe("version 1 files", () => {
  const v1 = () => {
    const b: any = valid(); // eslint-disable-line @typescript-eslint/no-explicit-any
    stripHoldings(b);
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
    expect([b.holdings, b.priceUpdates, b.corporateActions]).toEqual([[], [], []]);
    expect(b.settings).toEqual({
      monthStartDay: 25,
      savingsTargetMode: "flexible",
      savingsTargetAmount: null,
      savingsTargetPercent: null,
      expectedMonthlyIncome: null,
      expectedMonthlySpending: null,
      staleDaysHoldings: 7,
      goldPriceMode: "derive_24k",
      staleDaysGold: 14,
      staleDaysClouds: 30,
      budgetWarnAt: 0.8,
      budgetAlertAt: 1,
      targetStocks: null,
      targetGold: null,
      targetClouds: null,
      targetCash: null,
      insightMinPercent: 0.15,
      insightMinAmount: 50_000,
      remindReview: true,
      remindRecurring: true,
      remindStale: true,
      remindGoal: true,
      remindBudget: true,
      remindSavings: true,
    });
    expect([b.budgets, b.recurringTemplates]).toEqual([[], []]);
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
      ["unknown version", (b) => (b.version = 7 as never), "version: 7 is not supported"],
      ["fractional version", (b) => (b.version = 2.5 as never), "version: 2.5 is not supported"],
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

const trade = (b: Backup, n: number) => b.transactions[7 + n]; // 0 buy, 1 sale, 2 dividend of COMI; 3 void and 4 buy of GOLD_FUND
const holding0 = (b: Backup) => b.holdings[0];
const price0 = (b: Backup) => b.priceUpdates[0];
const action = (b: Backup, n: number) => b.corporateActions[n];

describe("parseBackup rejects (version 3 additions)", () => {
  describe("a version 3 file with a missing collection", () => {
    rejects([
      ["holdings missing", (b) => delete b.holdings, "holdings: must be a list"],
      ["priceUpdates not a list", (b) => (b.priceUpdates = {} as never), "priceUpdates: must be a list"],
      ["corporateActions missing", (b) => delete b.corporateActions, "corporateActions: must be a list"],
      ["assumptions missing", (b) => delete b.assumptions, "assumptions: must be an object"],
    ]);
  });

  describe("stale days and assumptions (user_settings check, rates)", () => {
    rejects([
      ["stale days missing", (b) => delete b.settings.staleDaysHoldings, "settings.staleDaysHoldings"],
      ["stale days zero", (b) => (b.settings.staleDaysHoldings = 0), "settings.staleDaysHoldings: must be a whole number of days from 1 to 365"],
      ["stale days 366", (b) => (b.settings.staleDaysHoldings = 366), "settings.staleDaysHoldings"],
      ["stale days with a fraction", (b) => (b.settings.staleDaysHoldings = 7.5), "settings.staleDaysHoldings"],
      ["assumption as text", (b) => (b.assumptions.stockReturn = "15%" as never), "assumptions.stockReturn"],
      ["assumption too large for the column", (b) => (b.assumptions.inflation = 100), "assumptions.inflation"],
      ["assumption missing", (b) => delete b.assumptions.goldReturn, "assumptions.goldReturn"],
    ]);
  });

  describe("holdings", () => {
    rejects([
      ["kind outside the enum", (b) => (holding0(b).kind = "crypto" as never), "holdings[0].kind: must be one of"],
      ["empty name", (b) => (holding0(b).name = " "), "holdings[0].name: must not be empty"],
      ["NUL character in the ticker", (b) => (holding0(b).ticker = "A\0B"), "holdings[0].ticker: must be text"],
      ["account that is not in the file", (b) => (holding0(b).accountId = id(99)), "holdings[0].accountId: refers to an account that is not in the file"],
      ["duplicate holding id", (b) => (b.holdings[1].id = COMI), "holdings.id: appears twice"],
      ["id that is not a uuid", (b) => (holding0(b).id = "COMI"), "holdings[0].id: must be a lowercase uuid"],
    ]);
  });

  describe("holding columns on transactions (transactions_holding_type_check, transactions_quantity_price_check)", () => {
    rejects([
      ["holding on an INCOME", (b) => (tx0(b).holdingId = COMI), "transactions[0].holdingId: only INVESTMENT_PURCHASE, INVESTMENT_SALE and DIVIDEND"],
      ["holding on an EXPENSE", (b) => (expense(b).holdingId = COMI), "may belong to a holding, not EXPENSE"],
      ["unknown holding", (b) => (trade(b, 0).holdingId = id(99)), "transactions[7].holdingId: refers to a holding that is not in the file"],
      ["buy of a holding without a quantity", (b) => (trade(b, 0).quantity = null), "needs a quantity above zero and a unitPrice"],
      ["buy of a holding without a unit price", (b) => (trade(b, 0).unitPrice = null), "needs a quantity above zero and a unitPrice"],
      ["sale with quantity zero", (b) => (trade(b, 1).quantity = "0.000000"), "INVESTMENT_SALE on a holding needs a quantity above zero"],
      ["quantity with 7 decimals", (b) => (trade(b, 0).quantity = "1.0000001"), "transactions[7].quantity: must be a decimal string"],
      ["quantity as a number", (b) => (trade(b, 0).quantity = 100 as never), "transactions[7].quantity"],
      ["quantity in exponent notation", (b) => (trade(b, 0).quantity = "1e3"), "transactions[7].quantity"],
      ["negative quantity", (b) => (trade(b, 0).quantity = "-5"), "transactions[7].quantity"],
      ["negative unit price", (b) => (trade(b, 0).unitPrice = "-1"), "transactions[7].unitPrice"],
      ["15 whole digits", (b) => (trade(b, 0).unitPrice = "100000000000000"), "transactions[7].unitPrice"],
      ["quantity on a dividend", (b) => (trade(b, 2).quantity = "1"), "only allowed on a purchase or sale that belongs to a holding"],
      ["unit price on a dividend", (b) => (trade(b, 2).unitPrice = "1"), "only allowed on a purchase or sale that belongs to a holding"],
      ["quantity on a purchase without a holding", (b) => (b.transactions[6].quantity = "5"), "only allowed on a purchase or sale that belongs to a holding"],
      ["holding column missing from a version 3 row", (b) => delete (tx0(b) as Partial<Backup["transactions"][number]>).holdingId, "transactions[0].holdingId"],
    ]);
  });

  describe("price updates (price_updates_price_check)", () => {
    rejects([
      ["negative price", (b) => (price0(b).price = "-0.5"), "priceUpdates[0].price: must be a decimal string"],
      ["price as a number", (b) => (price0(b).price = 11.25 as never), "priceUpdates[0].price"],
      ["price with 7 decimals", (b) => (price0(b).price = "1.1234567"), "priceUpdates[0].price"],
      ["impossible date", (b) => (price0(b).date = "2026-02-30"), "priceUpdates[0].date: must be a real date"],
      ["unknown holding", (b) => (price0(b).holdingId = id(99)), "priceUpdates[0].holdingId: refers to a holding that is not in the file"],
      ["duplicate id", (b) => (b.priceUpdates[1].id = id(81)), "priceUpdates.id: appears twice"],
    ]);

    it("accepts a price of zero (a worthless holding)", () => {
      const b = valid();
      price0(b).price = "0";
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("corporate actions (corporate_actions_kind_values_check)", () => {
    rejects([
      ["kind outside the enum", (b) => (action(b, 0).kind = "MERGER" as never), "corporateActions[0].kind: must be one of"],
      ["bonus without a quantity", (b) => (action(b, 0).quantity = null), "a BONUS needs a quantity above zero and no ratio"],
      ["bonus of zero", (b) => (action(b, 0).quantity = "0"), "a BONUS needs a quantity above zero and no ratio"],
      ["bonus with a ratio", (b) => (action(b, 0).ratio = "2"), "a BONUS needs a quantity above zero and no ratio"],
      ["split without a ratio", (b) => (action(b, 1).ratio = null), "a SPLIT needs a ratio above zero and no quantity"],
      ["split with ratio zero", (b) => (action(b, 1).ratio = "0.000000"), "a SPLIT needs a ratio above zero and no quantity"],
      ["split with a quantity", (b) => (action(b, 1).quantity = "5"), "a SPLIT needs a ratio above zero and no quantity"],
      ["write-off with a quantity", (b) => Object.assign(action(b, 1), { kind: "WRITE_OFF", ratio: null, quantity: "5" }), "a WRITE_OFF has neither a quantity nor a ratio"],
      ["write-off with a ratio", (b) => Object.assign(action(b, 1), { kind: "WRITE_OFF" }), "a WRITE_OFF has neither a quantity nor a ratio"],
      ["ratio with 7 decimals", (b) => (action(b, 1).ratio = "0.5000001"), "corporateActions[1].ratio: must be a decimal string"],
      ["unknown holding", (b) => (action(b, 0).holdingId = id(99)), "corporateActions[0].holdingId: refers to a holding that is not in the file"],
      ["duplicate id", (b) => (action(b, 1).id = id(91)), "corporateActions.id: appears twice"],
    ]);

    it("accepts a reverse split (ratio below 1) and a write-off", () => {
      const b = valid();
      action(b, 1).ratio = "0.5"; // 10 units -> 5
      expect(parseBackup(b).ok).toBe(true);
      Object.assign(action(b, 1), { kind: "WRITE_OFF", ratio: null });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  // validateHistory runs per holding, so a file with an impossible position is rejected before anything is written.
  describe("impossible positions (rule F)", () => {
    rejects([
      ["a sale of more than is held", (b) => (trade(b, 1).quantity = "200.000000"), "holdings[0]: the history leaves an impossible position (on 2026-03-20)"],
      ["a sale dated before the purchase", (b) => (trade(b, 1).date = "2026-02-15"), "holdings[0]: the history leaves an impossible position (on 2026-02-15)"],
      ["a purchase dated after the sale", (b) => (trade(b, 0).date = "2026-03-21"), "holdings[0]: the history leaves an impossible position"],
      ["a bonus dated after the sale is not enough to cover it", (b) => ((trade(b, 1).quantity = "105.000000"), (action(b, 0).date = "2026-03-21")), "holdings[0]: the history leaves an impossible position"],
      ["a reverse split that leaves too little for a later sale", (b) => Object.assign(action(b, 0), { kind: "SPLIT", quantity: null, ratio: "0.1", date: "2026-03-15" }), "holdings[0]: the history leaves an impossible position"],
      ["a write-off followed by a sale", (b) => Object.assign(action(b, 0), { kind: "WRITE_OFF", quantity: null, date: "2026-03-15" }), "holdings[0]: the history leaves an impossible position (on 2026-03-20)"],
      ["a dividend whose tax is not below the gross", (b) => (trade(b, 2).taxWithheld = 20_000), "holdings[0]: the history leaves an impossible position"],
      ["the other holding oversold too", (b) => Object.assign(trade(b, 4), { quantity: "10.000000", date: "2026-03-20", type: "INVESTMENT_SALE", fromAccountId: null, toAccountId: THNDR, holdingId: GOLD_FUND }), "holdings[1]: the history leaves an impossible position"],
    ]);

    it("ignores void and pending rows when replaying", () => {
      const b = valid();
      // The voided purchase of 5 and a pending sale of 1,000 would break the position if they counted.
      Object.assign(trade(b, 3), { status: "void" });
      Object.assign(trade(b, 1), { status: "void" });
      b.transactions.push({ ...trade(b, 1), id: id(190), status: "pending", quantity: "1000.000000", voidedAt: null });
      expect(parseBackup(b).ok).toBe(true);
    });

    it("accepts a sale of exactly the whole position", () => {
      const b = valid();
      Object.assign(trade(b, 1), { quantity: "110.000000", grossAmount: 132_000, amount: 131_850 }); // 1,320.00 - 1.00 fee - 0.50 tax
      expect(parseBackup(b).ok).toBe(true);
    });

    it("orders same-day events by creation time, so a sale entered before its purchase is refused", () => {
      const b = valid();
      Object.assign(trade(b, 1), { date: "2026-03-01", createdAt: "2026-03-01T07:00:00.000Z" });
      Object.assign(trade(b, 0), { createdAt: "2026-03-01T09:00:00.000Z" });
      expect(parseBackup(b)).toMatchObject({ ok: false });
      Object.assign(trade(b, 1), { createdAt: "2026-03-01T10:00:00.000Z" });
      expect(parseBackup(b).ok).toBe(true);
    });

    it("orders timestamps with and without milliseconds by time, not as text", () => {
      const b = valid();
      // As text, ".500Z" sorts before "Z"; by time the sale (09:00:00.000) comes first and oversells.
      Object.assign(trade(b, 1), { date: "2026-03-01", createdAt: "2026-03-01T09:00:00Z" });
      Object.assign(trade(b, 0), { createdAt: "2026-03-01T09:00:00.500Z" });
      expect(parseBackup(b)).toMatchObject({ ok: false });
    });
  });
});

const gold = (b: Backup) => b.holdings[2];
const cloud = (b: Backup) => b.holdings[3];
const goldBuy = (b: Backup) => b.transactions[12];
const deposit = (b: Backup) => b.transactions[13];
const withdrawal = (b: Backup) => b.transactions[15];
const principal = (b: Backup) => b.transactions[16];
const cashShare = (b: Backup) => b.goalAllocations[2];
const shareEvent = (b: Backup) => b.goalAllocationEvents[3];

describe("parseBackup rejects (version 4 additions)", () => {
  describe("a version 4 file with a missing collection", () => {
    rejects([
      ["goldPrices missing", (b) => delete b.goldPrices, "goldPrices: must be a list"],
      ["rateHistory not a list", (b) => (b.rateHistory = {} as never), "rateHistory: must be a list"],
      ["cloudConfirmations missing", (b) => delete b.cloudConfirmations, "cloudConfirmations: must be a list"],
      ["liabilities missing", (b) => delete b.liabilities, "liabilities: must be a list"],
      ["liabilityUpdates missing", (b) => delete b.liabilityUpdates, "liabilityUpdates: must be a list"],
    ]);
  });

  describe("gold price mode and stale days (user_settings checks)", () => {
    rejects([
      ["price mode outside the enum", (b) => (b.settings.goldPriceMode = "auto" as never), "settings.goldPriceMode: must be one of"],
      ["gold stale days zero", (b) => (b.settings.staleDaysGold = 0), "settings.staleDaysGold: must be a whole number of days from 1 to 365"],
      ["cloud stale days 366", (b) => (b.settings.staleDaysClouds = 366), "settings.staleDaysClouds: must be a whole number of days from 1 to 365"],
      ["cloud stale days with a fraction", (b) => (b.settings.staleDaysClouds = 7.5), "settings.staleDaysClouds"],
      ["gold stale days missing", (b) => delete b.settings.staleDaysGold, "settings.staleDaysGold"],
    ]);
  });

  describe("gold and cloud fields on holdings (holdings_*_check)", () => {
    rejects([
      ["gold without a karat", (b) => (gold(b).karat = null), "a gold holding needs a karat of 24, 21 or 18 and a form"],
      ["gold of 22 karat", (b) => (gold(b).karat = 22), "a gold holding needs a karat of 24, 21 or 18 and a form"],
      ["gold without a form", (b) => (gold(b).form = null), "a gold holding needs a karat of 24, 21 or 18 and a form"],
      ["form outside the enum", (b) => (gold(b).form = "ingot" as never), "holdings[2].form: must be one of"],
      ["a stock with a karat", (b) => (holding0(b).karat = 24), "only a gold holding has a karat and a form"],
      ["a fund with a form", (b) => (b.holdings[1].form = "bar"), "only a gold holding has a karat and a form"],
      ["gold with a start date", (b) => (gold(b).startDate = "2026-03-01"), "only a cloud has a start date, a maturity date or a contribution"],
      ["a stock with a contribution", (b) => Object.assign(holding0(b), { contributionAmount: 1_000, contributionFrequency: "weekly" }), "only a cloud has a start date"],
      ["a cloud with a karat", (b) => (cloud(b).karat = 24), "only a gold holding has a karat and a form"],
      ["a contribution without a frequency", (b) => (cloud(b).contributionFrequency = null), "contributionAmount and contributionFrequency are set together or not at all"],
      ["a frequency without a contribution", (b) => (cloud(b).contributionAmount = null), "contributionAmount and contributionFrequency are set together or not at all"],
      ["frequency outside the enum", (b) => (cloud(b).contributionFrequency = "daily" as never), "holdings[3].contributionFrequency: must be one of"],
      ["a contribution of zero", (b) => (cloud(b).contributionAmount = 0), "holdings[3].contributionAmount: must be above zero"],
      ["a maturity date before the start date", (b) => (cloud(b).maturityDate = "2026-02-28"), "holdings[3].maturityDate: must not be before the start date"],
      ["an impossible start date", (b) => (cloud(b).startDate = "2026-02-30"), "holdings[3].startDate: must be a real date"],
    ]);

    it("accepts a cloud with no maturity date and no contribution, and one maturing on its start date", () => {
      const b = valid();
      Object.assign(cloud(b), { maturityDate: null, contributionAmount: null, contributionFrequency: null });
      expect(parseBackup(b).ok).toBe(true);
      Object.assign(cloud(b), { maturityDate: cloud(b).startDate });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("gold prices (gold_prices_*_check)", () => {
    rejects([
      ["karat 22", (b) => (b.goldPrices[0].karat = 22), "goldPrices[0].karat: must be 24, 21 or 18"],
      ["karat as text", (b) => (b.goldPrices[0].karat = "21" as never), "goldPrices[0].karat"],
      ["negative price", (b) => (b.goldPrices[0].buybackPrice = "-1"), "goldPrices[0].buybackPrice: must be a decimal string"],
      ["price as a number", (b) => (b.goldPrices[0].buybackPrice = 4400 as never), "goldPrices[0].buybackPrice"],
      ["price with 7 decimals", (b) => (b.goldPrices[0].buybackPrice = "1.1234567"), "goldPrices[0].buybackPrice"],
      ["impossible date", (b) => (b.goldPrices[0].date = "2026-02-30"), "goldPrices[0].date: must be a real date"],
      ["duplicate id", (b) => (b.goldPrices[1].id = id(101)), "goldPrices.id: appears twice"],
    ]);

    it("accepts a price of zero", () => {
      const b = valid();
      b.goldPrices[0].buybackPrice = "0";
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("rate history (rate_history_apy_check, belongs to a cloud)", () => {
    rejects([
      ["APY of exactly -100%", (b) => (b.rateHistory[0].apy = -1), "rateHistory[0].apy: must be above -1"],
      ["APY below -100%", (b) => (b.rateHistory[0].apy = -1.5), "rateHistory[0].apy: must be above -1"],
      ["APY as text", (b) => (b.rateHistory[0].apy = "20%" as never), "rateHistory[0].apy"],
      ["APY too large for the column", (b) => (b.rateHistory[0].apy = 100), "rateHistory[0].apy"],
      ["a rate change of a stock", (b) => (b.rateHistory[0].holdingId = COMI), "rateHistory[0].holdingId: must belong to a cloud holding"],
      ["a rate change of gold", (b) => (b.rateHistory[0].holdingId = GOLD), "must belong to a cloud holding"],
      ["unknown holding", (b) => (b.rateHistory[0].holdingId = id(99)), "rateHistory[0].holdingId: refers to a holding that is not in the file"],
      ["impossible effective date", (b) => (b.rateHistory[0].effectiveDate = "2026-02-30"), "rateHistory[0].effectiveDate: must be a real date"],
      ["duplicate id", (b) => (b.rateHistory[1].id = id(111)), "rateHistory.id: appears twice"],
    ]);

    it("accepts a negative APY above -100%", () => {
      const b = valid();
      b.rateHistory[1].apy = -0.05;
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("cloud confirmations (cloud_confirmations_value_check, belongs to a cloud)", () => {
    rejects([
      ["negative value", (b) => (b.cloudConfirmations[0].value = -1), "cloudConfirmations[0].value: must not be negative"],
      ["value with a fraction", (b) => (b.cloudConfirmations[0].value = 10.5), "cloudConfirmations[0].value"],
      ["a confirmation of a stock", (b) => (b.cloudConfirmations[0].holdingId = COMI), "cloudConfirmations[0].holdingId: must belong to a cloud holding"],
      ["unknown holding", (b) => (b.cloudConfirmations[0].holdingId = id(99)), "cloudConfirmations[0].holdingId: refers to a holding"],
      ["duplicate id", (b) => b.cloudConfirmations.push({ ...b.cloudConfirmations[0] }), "cloudConfirmations.id: appears twice"],
    ]);

    it("accepts a confirmed value of zero", () => {
      const b = valid();
      b.cloudConfirmations[0].value = 0;
      // The 10,000.00 deposit is dated the same day and created before the confirmation, so only the later flows remain.
      Object.assign(withdrawal(b), { amount: 1_000, date: "2026-03-20" });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("quantity and unit price by holding kind", () => {
    rejects([
      ["a cloud deposit with a quantity and a price", (b) => Object.assign(deposit(b), { quantity: "1", unitPrice: "1" }), "transactions[13]: a cloud deposit or withdrawal has no quantity or unitPrice"],
      ["a cloud withdrawal with a quantity and a price", (b) => Object.assign(withdrawal(b), { quantity: "1", unitPrice: "1" }), "a cloud deposit or withdrawal has no quantity or unitPrice"],
      ["a cloud deposit with only a quantity", (b) => (deposit(b).quantity = "1"), "needs a quantity above zero and a unitPrice (a cloud deposit or withdrawal has neither)"],
      ["a gold purchase with neither", (b) => Object.assign(goldBuy(b), { quantity: null, unitPrice: null }), "transactions[12]: INVESTMENT_PURCHASE on a holding needs a quantity above zero and a unitPrice"],
      ["a stock sale with neither", (b) => Object.assign(trade(b, 1), { quantity: null, unitPrice: null }), "transactions[8]: INVESTMENT_SALE on a holding needs a quantity above zero and a unitPrice"],
      ["a dividend on a cloud", (b) => (trade(b, 2).holdingId = CLOUD), "transactions[9].holdingId: a cloud holding has no dividends"],
      ["a dividend on gold", (b) => (trade(b, 2).holdingId = GOLD), "a gold holding has no dividends"],
    ]);
  });

  describe("a cloud withdrawal never exceeds the estimated value (rate history, confirmations, deposits)", () => {
    rejects([
      ["a withdrawal above everything ever put in", (b) => (withdrawal(b).amount = 5_000_000), "holdings[3]: a withdrawal is larger than the cloud's estimated value (on 2026-03-20)"],
      ["a withdrawal dated before the second deposit", (b) => Object.assign(withdrawal(b), { date: "2026-03-02", amount: 1_500_000 }), "holdings[3]: a withdrawal is larger than the cloud's estimated value (on 2026-03-02)"],
      ["a withdrawal on a cloud that has nothing in it", (b) => Object.assign(withdrawal(b), { date: "2026-02-01" }), "holdings[3]: a withdrawal is larger than the cloud's estimated value (on 2026-02-01)"],
      [
        "a deposit moved to after the withdrawal that needed it",
        (b) => {
          Object.assign(b.transactions[14], { date: "2026-03-25" });
          withdrawal(b).amount = 1_100_000;
        },
        "holdings[3]: a withdrawal is larger",
      ],
    ]);

    it("a confirmed lower value makes a later withdrawal too large", () => {
      const b = valid();
      b.cloudConfirmations.push({ id: id(122), holdingId: CLOUD, date: "2026-03-19", value: 100_000, createdAt: "2026-03-19T09:00:00.000Z" });
      expect(parseBackup(b)).toMatchObject({ ok: false });
    });

    it("accepts a withdrawal of exactly the estimated value, and refuses one piaster more", () => {
      const b = valid();
      // Dated on the confirmation day and created after it: the estimate is exactly the confirmed 10,000.00.
      Object.assign(withdrawal(b), { date: "2026-03-01", createdAt: "2026-03-01T12:00:00.000Z", amount: 1_000_000 });
      expect(parseBackup(b).ok).toBe(true);
      withdrawal(b).amount = 1_000_001;
      expect(parseBackup(b)).toMatchObject({ ok: false });
    });

    it("ignores a void or pending withdrawal", () => {
      const b = valid();
      Object.assign(withdrawal(b), { amount: 5_000_000, status: "void", voidedAt: "2026-03-21T09:00:00.000Z" });
      expect(parseBackup(b).ok).toBe(true);
      Object.assign(withdrawal(b), { status: "pending", voidedAt: null });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("the cash of a posted unit trade matches quantity x unit price (+/- fee and tax)", () => {
    rejects([
      ["a purchase that cost a piaster more", (b) => (trade(b, 0).amount += 1), "transactions[7].amount: does not equal quantity x unitPrice plus fee"],
      ["a purchase whose fee was not added", (b) => (trade(b, 0).fee = 0), "transactions[7].amount: does not equal quantity x unitPrice plus fee"],
      ["a gold purchase without its workmanship", (b) => (goldBuy(b).amount = 4_000_000), "transactions[12].amount: does not equal quantity x unitPrice plus fee"],
      ["a gold purchase whose metal price changed", (b) => (goldBuy(b).unitPrice = "4001.000000"), "transactions[12].amount: does not equal"],
      ["a sale that paid a piaster more", (b) => (trade(b, 1).amount += 1), "transactions[8].amount: does not equal quantity x unitPrice minus fee and tax withheld"],
      ["a sale whose tax was ignored", (b) => (trade(b, 1).taxWithheld = null), "transactions[8].amount: does not equal quantity x unitPrice minus fee and tax withheld"],
      ["a sale with the wrong gross amount", (b) => (trade(b, 1).grossAmount = 48_001), "transactions[8].grossAmount: does not equal quantity x unitPrice"],
      ["a sale with no gross amount", (b) => (trade(b, 1).grossAmount = null), "transactions[8].grossAmount: does not equal quantity x unitPrice"],
      ["a purchase whose quantity changed but not its cash", (b) => (trade(b, 4).quantity = "11.000000"), "transactions[11].amount: does not equal quantity x unitPrice plus fee"],
    ]);

    it("does not check void or pending trades, which move no money", () => {
      const b = valid();
      trade(b, 3).amount = 1; // the voided purchase of 5 units
      b.transactions[6].amount = 1; // the pending purchase
      expect(parseBackup(b).ok).toBe(true);
    });

    it("accepts a sale whose fee and tax are zero", () => {
      const b = valid();
      Object.assign(trade(b, 1), { fee: 0, taxWithheld: null, amount: 48_000 });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("liabilities and their updates (liabilities_*_check, liability_updates_delta_check)", () => {
    rejects([
      ["opening balance zero", (b) => (b.liabilities[0].openingBalance = 0), "liabilities[0].openingBalance: must be above zero"],
      ["opening balance negative", (b) => (b.liabilities[0].openingBalance = -5), "liabilities[0].openingBalance: must be above zero"],
      ["opening balance with a fraction", (b) => (b.liabilities[0].openingBalance = 10.5), "liabilities[0].openingBalance"],
      ["negative interest rate", (b) => (b.liabilities[0].interestRate = -0.01), "liabilities[0].interestRate: must not be negative"],
      ["interest rate as text", (b) => (b.liabilities[0].interestRate = "18%" as never), "liabilities[0].interestRate"],
      ["kind outside the enum", (b) => (b.liabilities[0].kind = "mortgage" as never), "liabilities[0].kind: must be one of"],
      ["empty name", (b) => (b.liabilities[0].name = " "), "liabilities[0].name: must not be empty"],
      ["impossible start date", (b) => (b.liabilities[0].startDate = "2026-02-30"), "liabilities[0].startDate: must be a real date"],
      ["duplicate liability id", (b) => b.liabilities.push({ ...b.liabilities[0] }), "liabilities.id: appears twice"],
      ["update of zero", (b) => (b.liabilityUpdates[0].delta = 0), "liabilityUpdates[0].delta: must not be zero"],
      ["update with a fraction", (b) => (b.liabilityUpdates[0].delta = 0.5), "liabilityUpdates[0].delta"],
      ["update of an unknown liability", (b) => (b.liabilityUpdates[0].liabilityId = id(99)), "liabilityUpdates[0].liabilityId: refers to a liability that is not in the file"],
      ["update with an impossible date", (b) => (b.liabilityUpdates[0].date = "2026-02-30"), "liabilityUpdates[0].date: must be a real date"],
      ["duplicate update id", (b) => (b.liabilityUpdates[1].id = id(131)), "liabilityUpdates.id: appears twice"],
    ]);

    it("accepts a liability with no interest rate, archived, and a negative update", () => {
      const b = valid();
      Object.assign(b.liabilities[0], { interestRate: null, archivedAt: "2026-04-01T00:00:00.000Z" });
      expect(b.liabilityUpdates[1].delta).toBeLessThan(0);
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("liability payments (transactions_liability_type_check, principal within the outstanding balance)", () => {
    rejects([
      ["a liability id on an INCOME", (b) => (tx0(b).liabilityId = LOAN), "transactions[0].liabilityId: only a LIABILITY_PAYMENT or an EXPENSE may belong to a liability, not INCOME"],
      ["a liability id on a transfer", (b) => (transfer(b).liabilityId = LOAN), "only a LIABILITY_PAYMENT or an EXPENSE may belong to a liability, not TRANSFER"],
      ["a payment of an unknown liability", (b) => (principal(b).liabilityId = id(99)), "transactions[16].liabilityId: refers to a liability that is not in the file"],
      ["an interest expense of an unknown liability", (b) => (b.transactions[17].liabilityId = id(99)), "transactions[17].liabilityId: refers to a liability"],
      ["a principal payment above the balance", (b) => (principal(b).amount = 2_000_000), "liabilities[0]: the balance goes below zero on 2026-03-18"],
      [
        "two payments that together exceed the balance",
        (b) => b.transactions.push({ ...principal(b), id: id(140), amount: 1_200_000 }),
        "liabilities[0]: the balance goes below zero on 2026-03-20",
      ],
      ["a payment after a correction that removed the balance", (b) => (b.liabilityUpdates[1].delta = -1_300_000), "liabilities[0]: the balance goes below zero on 2026-03-20"],
      [
        "a payment dated before the borrowing that funds it",
        (b) => {
          b.liabilityUpdates[0].date = "2026-03-19";
          principal(b).amount = 1_200_000;
        },
        "liabilities[0]: the balance goes below zero on 2026-03-18",
      ],
    ]);

    it("accepts a payment of exactly the balance, and refuses one piaster more", () => {
      const b = valid();
      principal(b).amount = 1_450_000; // 10,000.00 opening + 5,000.00 borrowed - 500.00 correction
      expect(parseBackup(b).ok).toBe(true);
      principal(b).amount = 1_450_001;
      expect(parseBackup(b)).toMatchObject({ ok: false });
    });

    it("ignores a voided payment, and accepts a payment against a general (credit card) liability id of null", () => {
      const b = valid();
      Object.assign(principal(b), { amount: 5_000_000, status: "void", voidedAt: "2026-03-19T09:00:00.000Z" });
      expect(parseBackup(b).ok).toBe(true);
      Object.assign(principal(b), { status: "posted", voidedAt: null, liabilityId: null, amount: 5_000_000 });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("goal shares of holdings (goal_allocations_shape_check, unique goal and holding, at most 100% per holding)", () => {
    rejects([
      ["a share of zero", (b) => (cashShare(b).percent = 0), "goalAllocations[2]: a holding share needs a holdingId and a percent above 0 and up to 1"],
      ["a share above 100%", (b) => (cashShare(b).percent = 1.5), "a holding share needs a holdingId and a percent above 0 and up to 1"],
      ["a negative share", (b) => (cashShare(b).percent = -0.1), "a holding share needs a holdingId and a percent above 0 and up to 1"],
      ["a share with 7 decimals", (b) => (cashShare(b).percent = 0.1234567), "goalAllocations[2].percent: must have at most 6 decimals"],
      ["a share as text", (b) => (cashShare(b).percent = "25%" as never), "goalAllocations[2].percent"],
      ["a share without a holding", (b) => (cashShare(b).holdingId = null), "a holding share needs a holdingId"],
      ["a share without a percent", (b) => (cashShare(b).percent = null), "a holding share needs a holdingId and a percent"],
      ["a share that also has an account", (b) => (cashShare(b).accountId = BANK), "a cash allocation needs an accountId and an amount, and no holdingId or percent"],
      ["a share that also has an amount", (b) => (cashShare(b).amount = 100), "a holding share needs a holdingId and a percent above 0 and up to 1, and no accountId or amount"],
      ["a cash allocation that also has a holding", (b) => (alloc0(b).holdingId = CLOUD), "a cash allocation needs an accountId and an amount, and no holdingId or percent"],
      ["a cash allocation that also has a percent", (b) => (alloc0(b).percent = 0.5), "a cash allocation needs an accountId and an amount, and no holdingId or percent"],
      ["an allocation with neither shape", (b) => Object.assign(alloc0(b), { accountId: null, amount: null }), "a holding share needs a holdingId"],
      ["a share of an unknown holding", (b) => (cashShare(b).holdingId = id(99)), "goalAllocations[2].holdingId: refers to a holding that is not in the file"],
      ["the same goal and holding twice", (b) => (b.goalAllocations[3].goalId = EMERGENCY), "goalAllocations (goal and holding): appears twice"],
      ["shares that add up to a millionth over 100%", (b) => (b.goalAllocations[3].percent = 0.750001), "the shares of holding"],
    ]);

    it("accepts shares that add up to exactly 100%, and a lone share of 100%", () => {
      const b = valid();
      expect(cashShare(b).percent).toBe(0.25);
      expect(b.goalAllocations[3].percent).toBe(0.75);
      expect(parseBackup(b).ok).toBe(true);
      b.goalAllocations.splice(3, 1);
      cashShare(b).percent = 1;
      expect(parseBackup(b).ok).toBe(true);
    });

    it("counts shares of different holdings separately", () => {
      const b = valid();
      b.goalAllocations[3].holdingId = GOLD;
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("goal share events (goal_allocation_events_shape_check)", () => {
    rejects([
      ["a holding event without a percent change", (b) => (shareEvent(b).percentDelta = null), "an event needs an accountId, or a holdingId with a percentDelta that is not zero"],
      ["a holding event with a zero percent change", (b) => (shareEvent(b).percentDelta = 0), "an event needs an accountId, or a holdingId with a percentDelta that is not zero"],
      ["an event with neither account nor holding", (b) => (shareEvent(b).holdingId = null), "an event needs an accountId, or a holdingId"],
      ["an account event that also has a holding", (b) => (event0(b).holdingId = CLOUD), "an account event has no holdingId or percentDelta"],
      ["an account event that also has a percent change", (b) => (event0(b).percentDelta = 0.1), "an account event has no holdingId or percentDelta"],
      ["a holding event with an account", (b) => (shareEvent(b).accountId = BANK), "an account event has no holdingId or percentDelta"],
      ["a holding event of an unknown holding", (b) => (shareEvent(b).holdingId = id(99)), "goalAllocationEvents[3].holdingId: refers to a holding that is not in the file"],
      ["a holding event with an EGP value of zero", (b) => (shareEvent(b).delta = 0), "goalAllocationEvents[3].delta: must not be zero"],
      ["a percent change with 7 decimals", (b) => (shareEvent(b).percentDelta = 0.1234567), "goalAllocationEvents[3].percentDelta: must have at most 6 decimals"],
    ]);

    it("accepts a negative percent change (a share that was lowered)", () => {
      const b = valid();
      Object.assign(shareEvent(b), { percentDelta: -0.1, delta: -150_000 });
      expect(parseBackup(b).ok).toBe(true);
    });
  });
});

const retainerRow = (b: Backup) => b.transactions[18];
const pendingMeal = (b: Backup) => b.transactions[19];
const skippedMeal = (b: Backup) => b.transactions[20];
const overallBudget = (b: Backup) => b.budgets[0];
const foodBudget = (b: Backup) => b.budgets[1];
const retainer = (b: Backup) => b.recurringTemplates[0];
const mealPlan = (b: Backup) => b.recurringTemplates[1];
const emergencyGoal = (b: Backup) => b.goals[0];

describe("round trip of budgets, recurring templates and expense-based goals (version 5)", () => {
  it("keeps every new table and column, with thresholds as decimals", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.budgets.map((x) => [x.categoryId, x.amount])).toEqual([[null, 2_000_000], [FOOD, 500_000]]);
    expect(backup.recurringTemplates.map((t) => [t.name, t.type, t.frequency, t.endDate, t.autoPost, t.active])).toEqual([
      ["Retainer", "INCOME", "monthly", null, true, true],
      ["Meal plan", "EXPENSE", "weekly", "2026-12-31", false, false],
    ]);
    expect(backup.transactions.slice(18).map((t) => [t.status, t.recurringTemplateId, t.recurringDueDate])).toEqual([
      ["posted", RETAINER, "2026-03-05"],
      ["pending", MEAL_PLAN, "2026-03-15"],
      ["void", MEAL_PLAN, "2026-03-08"],
    ]);
    expect(backup.goals.map((g) => [g.targetMode, g.targetMonths])).toEqual([["expense_months", 6], ["manual", null]]);
    expect([backup.settings.budgetWarnAt, backup.settings.budgetAlertAt]).toEqual([0.75, 1]);
    expect(JSON.stringify(backup)).not.toContain("user-1");
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup });
  });

  it("restores a pending row as pending: only the posted income counts toward the balance", () => {
    const parsed = parseBackup(JSON.parse(JSON.stringify(serializeBackup(rows, EXPORTED_AT))));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.transactions.slice(18).map((t) => t.status)).toEqual(["posted", "pending", "void"]);
    expect(balances(parsed.backup)[BANK]).toBe(balances(serializeBackup(rows, EXPORTED_AT))[BANK]);
  });
});

describe("version 4 files", () => {
  const v4 = () => {
    const b: any = valid(); // eslint-disable-line @typescript-eslint/no-explicit-any
    stripV5(b);
    b.version = 4;
    return b;
  };

  it("still restore, with no budgets or templates, manual goals, unlinked transactions and the default thresholds", () => {
    const file = v4();
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const b = parsed.backup;
    expect(b.version).toBe(BACKUP_VERSION);
    expect([b.budgets, b.recurringTemplates]).toEqual([[], []]);
    expect(b.goals.every((g) => g.targetMode === "manual" && g.targetMonths === null)).toBe(true);
    expect(b.transactions.every((t) => t.recurringTemplateId === null && t.recurringDueDate === null)).toBe(true);
    expect([b.settings.budgetWarnAt, b.settings.budgetAlertAt]).toEqual([0.8, 1]);
    expect(b.liabilities).toHaveLength(1);
    expect(balances(b)).toEqual(balances(file));
  });

  it("are still validated like before", () => {
    const file = v4();
    file.liabilities[0].openingBalance = 0;
    expect(parseBackup(file)).toMatchObject({ ok: false });
  });

  it("ignore new-format fields they should not have", () => {
    const file = v4();
    file.transactions[0].recurringTemplateId = id(99);
    file.goals[0].targetMode = "expense_months";
    file.settings.budgetWarnAt = 5;
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect([parsed.backup.transactions[0].recurringTemplateId, parsed.backup.goals[0].targetMode, parsed.backup.settings.budgetWarnAt]).toEqual([null, "manual", 0.8]);
    }
  });
});

describe("parseBackup rejects (version 5 additions)", () => {
  describe("a version 5 file with a missing collection", () => {
    rejects([
      ["budgets missing", (b) => delete b.budgets, "budgets: must be a list"],
      ["recurringTemplates not a list", (b) => (b.recurringTemplates = {} as never), "recurringTemplates: must be a list"],
    ]);
  });

  describe("budgets (budgets_amount_check, one overall, one per category)", () => {
    rejects([
      ["amount zero", (b) => (overallBudget(b).amount = 0), "budgets[0].amount: must be above zero"],
      ["amount negative", (b) => (foodBudget(b).amount = -1), "budgets[1].amount: must be above zero"],
      ["amount with a fraction", (b) => (overallBudget(b).amount = 10.5), "budgets[0].amount"],
      ["a second overall budget", (b) => b.budgets.push({ ...overallBudget(b), id: id(143) }), "budgets: at most one overall budget"],
      ["two budgets for one category", (b) => b.budgets.push({ ...foodBudget(b), id: id(143) }), "budgets (category): appears twice"],
      ["a budget of an unknown category", (b) => (foodBudget(b).categoryId = id(99)), "budgets[1].categoryId: refers to a category that is not in the file"],
      ["duplicate id", (b) => (foodBudget(b).id = id(141)), "budgets.id: appears twice"],
    ]);

    it("accepts budgets of several categories, and none at all", () => {
      const b = valid();
      b.budgets.push({ ...foodBudget(b), id: id(143), categoryId: LOAN_INTEREST });
      expect(parseBackup(b).ok).toBe(true);
      b.budgets = [];
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("recurring templates (recurring_templates_*_check, references)", () => {
    rejects([
      ["amount zero", (b) => (retainer(b).amount = 0), "recurringTemplates[0].amount: must be above zero"],
      ["amount with a fraction", (b) => (retainer(b).amount = 0.5), "recurringTemplates[0].amount"],
      ["type TRANSFER", (b) => (retainer(b).type = "TRANSFER" as never), "recurringTemplates[0].type: must be one of INCOME, EXPENSE"],
      ["frequency daily", (b) => (retainer(b).frequency = "daily" as never), "recurringTemplates[0].frequency: must be one of"],
      ["end date before the start date", (b) => (mealPlan(b).endDate = "2026-02-28"), "recurringTemplates[1].endDate: must not be before the start date"],
      ["impossible start date", (b) => (retainer(b).startDate = "2026-02-30"), "recurringTemplates[0].startDate: must be a real date"],
      ["unknown account", (b) => (retainer(b).accountId = id(99)), "recurringTemplates[0].accountId: refers to an account that is not in the file"],
      ["unknown category", (b) => (retainer(b).categoryId = id(99)), "recurringTemplates[0].categoryId: refers to a category that is not in the file"],
      ["auto post given as text", (b) => (retainer(b).autoPost = "yes" as never), "recurringTemplates[0].autoPost"],
      ["active missing", (b) => delete b.recurringTemplates[0].active, "recurringTemplates[0].active"],
      ["empty name", (b) => (retainer(b).name = " "), "recurringTemplates[0].name: must not be empty"],
      ["duplicate id", (b) => (mealPlan(b).id = RETAINER), "recurringTemplates.id: appears twice"],
    ]);

    it("accepts a template with no category, no end date, and one ending on its start date", () => {
      const b = valid();
      Object.assign(retainer(b), { categoryId: null });
      Object.assign(mealPlan(b), { endDate: mealPlan(b).startDate });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("recurring links on transactions (transactions_recurring_check, one row per template and due date)", () => {
    rejects([
      ["a template without a due date", (b) => (retainerRow(b).recurringDueDate = null), "transactions[18]: recurringTemplateId and recurringDueDate are set together or not at all"],
      ["a due date without a template", (b) => (retainerRow(b).recurringTemplateId = null), "set together or not at all"],
      ["an unknown template", (b) => (retainerRow(b).recurringTemplateId = id(99)), "transactions[18].recurringTemplateId: refers to a recurring template that is not in the file"],
      ["an impossible due date", (b) => (retainerRow(b).recurringDueDate = "2026-02-30"), "transactions[18].recurringDueDate: must be a real date"],
      ["a due date taken twice (the first one pending, the second skipped)", (b) => (skippedMeal(b).recurringDueDate = "2026-03-15"), "transactions (recurring template and due date): appears twice"],
      ["a due date taken twice by posted rows", (b) => b.transactions.push({ ...retainerRow(b), id: id(160), createdAt: "2026-03-06T09:00:00.000Z" }), "transactions (recurring template and due date): appears twice"],
    ]);

    it("accepts the same due date on two templates, and a skipped row whose date moved away from its due date", () => {
      const b = valid();
      Object.assign(skippedMeal(b), { recurringTemplateId: RETAINER, recurringDueDate: "2026-03-15" });
      expect(parseBackup(b).ok).toBe(true);
      Object.assign(pendingMeal(b), { date: "2026-04-02" });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("expense-based goal targets (goals_target_mode_check)", () => {
    rejects([
      ["expense_months without months", (b) => (emergencyGoal(b).targetMonths = null), "goals[0]: targetMonths is set exactly when targetMode is expense_months"],
      ["manual with months", (b) => (b.goals[1].targetMonths = 6), "goals[1]: targetMonths is set exactly when targetMode is expense_months"],
      ["mode outside the enum", (b) => (emergencyGoal(b).targetMode = "weekly" as never), "goals[0].targetMode: must be one of"],
      ["0 months", (b) => (emergencyGoal(b).targetMonths = 0), "goals[0].targetMonths: must be a whole number from 1 to 60"],
      ["61 months", (b) => (emergencyGoal(b).targetMonths = 61), "goals[0].targetMonths: must be a whole number from 1 to 60"],
      ["months with a fraction", (b) => (emergencyGoal(b).targetMonths = 6.5), "goals[0].targetMonths"],
    ]);

    it("accepts 1 and 60 months", () => {
      const b = valid();
      emergencyGoal(b).targetMonths = 1;
      expect(parseBackup(b).ok).toBe(true);
      emergencyGoal(b).targetMonths = 60;
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("budget thresholds (user_settings_budget_thresholds_check)", () => {
    rejects([
      ["warning of zero", (b) => (b.settings.budgetWarnAt = 0), "settings: budgetWarnAt must be above 0"],
      ["warning above the alert", (b) => (b.settings.budgetWarnAt = 1.1), "settings: budgetWarnAt must be above 0, no higher than budgetAlertAt"],
      ["alert above 200%", (b) => (b.settings.budgetAlertAt = 2.5), "settings: budgetWarnAt must be above 0"],
      ["warning with 4 decimals", (b) => (b.settings.budgetWarnAt = 0.7501), "settings.budgetWarnAt: must have at most 3 decimals"],
      ["alert as text", (b) => (b.settings.budgetAlertAt = "100%" as never), "settings.budgetAlertAt"],
      ["warning missing", (b) => delete b.settings.budgetWarnAt, "settings.budgetWarnAt"],
    ]);

    it("accepts a warning equal to the alert, and an alert of exactly 200%", () => {
      const b = valid();
      Object.assign(b.settings, { budgetWarnAt: 2, budgetAlertAt: 2 });
      expect(parseBackup(b).ok).toBe(true);
    });
  });
});

describe("parseBackup rejects a liability whose balance goes below zero (opening balance plus manual updates)", () => {
  const update = (b: Backup, n: number, date: string, delta: number, createdAt = `${date}T09:00:00.000Z`) =>
    b.liabilityUpdates.push({ id: id(n), liabilityId: LOAN, date, delta, note: null, createdAt });

  const owed = (b: Backup) =>
    b.liabilities[0].openingBalance + b.liabilityUpdates.filter((u) => u.liabilityId === LOAN).reduce((t, u) => t + u.delta, 0);

  rejects([
    ["a correction larger than everything owed", (b) => (b.liabilityUpdates[1].delta = -1_600_000), "liabilities[0]: the balance goes below zero on 2026-03-20"],
  ]);

  const paid = (b: Backup) =>
    b.transactions
      .filter((t) => t.type === "LIABILITY_PAYMENT" && t.status === "posted" && t.liabilityId === LOAN)
      .reduce((t, x) => t + x.amount, 0);

  // The app replays in date order (validateLiabilityHistory), so a file it produced always restores and one it would refuse does not.
  it("refuses a correction dated before the borrowing that covers it, and accepts it once the borrowing is dated first", () => {
    const b = valid();
    const dip = b.liabilities[0].openingBalance + 1; // on its own date this takes the running balance below zero
    update(b, 133, "2026-01-01", -dip);
    update(b, 134, "2026-06-01", dip);
    expect(parseBackup(b)).toMatchObject({ ok: false });
    b.liabilityUpdates[b.liabilityUpdates.length - 1].date = "2025-12-31";
    expect(parseBackup(b).ok).toBe(true);
  });

  it("accepts a balance that reaches exactly zero, and refuses a piaster below", () => {
    const b = valid();
    update(b, 133, "2026-03-25", -(owed(b) - paid(b)));
    expect(parseBackup(b).ok).toBe(true);
    b.liabilityUpdates[b.liabilityUpdates.length - 1].delta -= 1;
    expect(parseBackup(b)).toMatchObject({ ok: false });
  });

  it("does not look at the balance of another liability", () => {
    const b = valid();
    b.liabilities.push({ ...b.liabilities[0], id: id(61), name: "Second loan" });
    expect(parseBackup(b).ok).toBe(true);
  });
});

// Error text is shown as plain text, which privacy mode does not hide: only the row path and a date may carry digits.
describe("restore errors never quote quantities, grams or amounts", () => {
  const strip = (message: string) => message.replace(/[A-Za-z]+\[\d+\]/g, "").replace(/\d{4}-\d{2}-\d{2}/g, "");
  const goldSale = (b: Backup, quantity: string) =>
    b.transactions.push({
      ...goldBuy(b),
      id: id(170),
      type: "INVESTMENT_SALE",
      date: "2026-03-20",
      amount: 1,
      fee: 0,
      grossAmount: 1,
      fromAccountId: null,
      toAccountId: THNDR,
      quantity,
      unitPrice: "0.000001",
      createdAt: "2026-03-20T09:00:00.000Z",
    });

  it.each<[string, Mutate, string]>([
    ["selling more units than held", (b) => (trade(b, 1).quantity = "200.123456"), "holdings[0]: the history leaves an impossible position (on 2026-03-20)"],
    ["selling more grams of gold than held", (b) => goldSale(b, "15.500000"), "holdings[2]: the history leaves an impossible position (on 2026-03-20)"],
    ["a purchase too large to price", (b) => Object.assign(trade(b, 0), { quantity: "99999999999999.999999", unitPrice: "99999999999999.999999" }), "holdings[0]: the history leaves an impossible position"],
    ["a sale whose fee exceeds its proceeds", (b) => (trade(b, 1).fee = 4_000_000), "holdings[0]: the history leaves an impossible position"],
    [
      "a cloud too large to value",
      (b) => {
        b.cloudConfirmations[0].value = 8_000_000_000_000_000;
        b.rateHistory[0].apy = 99;
      },
      "holdings[3]: cannot be valued",
    ],
    ["a cloud withdrawal above its value", (b) => (withdrawal(b).amount = 5_000_000), "holdings[3]: a withdrawal is larger than the cloud's estimated value (on 2026-03-20)"],
    ["a loan payment above the balance", (b) => (principal(b).amount = 2_000_000), "liabilities[0]: the balance goes below zero on 2026-03-18"],
    ["a loan correction below zero", (b) => (b.liabilityUpdates[1].delta = -1_600_000), "liabilities[0]: the balance goes below zero on 2026-03-20"],
    ["a purchase paid a piaster more", (b) => (trade(b, 0).amount += 1), "transactions[7].amount: does not equal quantity x unitPrice plus fee"],
    ["a sale with the wrong gross", (b) => (trade(b, 1).grossAmount = 48_001), "transactions[8].grossAmount: does not equal quantity x unitPrice"],
  ])("%s", (_name, mutate, expected) => {
    const b = valid();
    mutate(b);
    const result = parseBackup(b);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(expected);
    expect(strip(result.error)).not.toMatch(/\d/);
  });
});

// A compile-time check as much as a test: tsc fails if the export route's loader leaves a table out.
describe("the export route", () => {
  type RouteRows = Awaited<ReturnType<typeof loadBackupRows>>;
  type TablesNobodySerializes = Exclude<keyof Backup, "version" | "exportedAt" | keyof BackupRows>;

  it("builds every table serializeBackup takes, and serializeBackup takes every table the backup holds", () => {
    const routeFeedsSerializer = (rowsFromRoute: RouteRows): BackupRows => rowsFromRoute;
    const noTableLeftOut: [TablesNobodySerializes] extends [never] ? true : never = true;
    expect(routeFeedsSerializer).toBeTypeOf("function");
    expect(noTableLeftOut).toBe(true);
    expect(Object.keys(serializeBackup(rows, EXPORTED_AT)).sort()).toEqual(
      ["version", "exportedAt", ...(Object.keys(rows) as (keyof BackupRows)[])].sort(),
    );
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

describe("round trip of targets, insight thresholds, reminder switches and income growth (version 6)", () => {
  it("keeps every new setting, with shares as numbers and the amount in piasters", () => {
    const backup = serializeBackup(rows, EXPORTED_AT);
    expect(backup.version).toBe(6);
    expect(backup.settings).toMatchObject({
      targetStocks: 0.4,
      targetGold: 0.1,
      targetClouds: 0.2,
      targetCash: 0.3,
      insightMinPercent: 0.2,
      insightMinAmount: 75_000,
      remindReview: true,
      remindRecurring: false,
      remindBudget: false,
    });
    expect(backup.assumptions.incomeGrowth).toBe(0.05);
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup });
  });

  it("round trips with no targets set and a blank income growth", () => {
    const none = { ...rows.settings, targetStocks: null, targetGold: null, targetClouds: null, targetCash: null };
    const backup = serializeBackup({ ...rows, settings: none, assumptions: { ...rows.assumptions, incomeGrowth: null } }, EXPORTED_AT);
    expect(backup.settings.targetStocks).toBeNull();
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup });
  });
});

describe("version 5 files", () => {
  const v5 = () => {
    const b: any = valid(); // eslint-disable-line @typescript-eslint/no-explicit-any
    stripV6(b);
    b.version = 5;
    return b;
  };

  it("still restore, with no targets, the default thresholds, every reminder on and no income growth", () => {
    const file = v5();
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const b = parsed.backup;
    expect(b.version).toBe(BACKUP_VERSION);
    expect([b.settings.targetStocks, b.settings.targetGold, b.settings.targetClouds, b.settings.targetCash]).toEqual([null, null, null, null]);
    expect([b.settings.insightMinPercent, b.settings.insightMinAmount]).toEqual([0.15, 50_000]);
    expect([b.settings.remindReview, b.settings.remindRecurring, b.settings.remindStale, b.settings.remindGoal, b.settings.remindBudget, b.settings.remindSavings]).toEqual(Array(6).fill(true));
    expect(b.assumptions.incomeGrowth).toBeNull();
    expect([b.settings.budgetWarnAt, b.settings.budgetAlertAt]).toEqual([0.75, 1]);
    expect(b.budgets).toHaveLength(2);
    expect(balances(b)).toEqual(balances(file));
  });

  it("ignore new-format fields they should not have", () => {
    const file = v5();
    Object.assign(file.settings, { targetStocks: 0.9, insightMinPercent: 5, remindReview: false });
    file.assumptions.incomeGrowth = 0.5;
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect([parsed.backup.settings.targetStocks, parsed.backup.settings.insightMinPercent, parsed.backup.settings.remindReview, parsed.backup.assumptions.incomeGrowth]).toEqual([null, 0.15, true, null]);
    }
  });

  it("are still validated like before", () => {
    const file = v5();
    file.liabilities[0].openingBalance = 0;
    expect(parseBackup(file)).toMatchObject({ ok: false });
  });
});

describe("parseBackup rejects (version 6 additions)", () => {
  describe("portfolio targets (user_settings_target_mix_check)", () => {
    rejects([
      ["some targets set and some not", (b) => (b.settings.targetCash = null), "settings: Set a target for all four classes, or clear them all."],
      ["targets that total 99%", (b) => (b.settings.targetCash = 0.29), "settings: Your targets must add up to 100%."],
      ["targets that total 101%", (b) => (b.settings.targetCash = 0.31), "settings: Your targets must add up to 100%."],
      ["a target above 100%", (b) => Object.assign(b.settings, { targetStocks: 1.2, targetGold: -0.1, targetClouds: 0, targetCash: -0.1 }), "settings: Each target must be between 0% and 100%."],
      ["a negative target", (b) => Object.assign(b.settings, { targetStocks: 0.5, targetGold: -0.1, targetClouds: 0.3, targetCash: 0.3 }), "settings: Each target must be between 0% and 100%."],
      ["a target with 6 decimals", (b) => (b.settings.targetStocks = 0.400001), "settings.targetStocks: must have at most 5 decimals"],
      ["a target that is not a number", (b) => (b.settings.targetGold = "10%" as never), "settings.targetGold: must be a decimal rate"],
      ["a target left out", (b) => delete (b.settings as Partial<typeof b.settings>).targetGold, "settings.targetGold"],
    ]);

    it("accepts all four blank, a 100% single class and shares with 5 decimals that total 100%", () => {
      const b = valid();
      Object.assign(b.settings, { targetStocks: null, targetGold: null, targetClouds: null, targetCash: null });
      expect(parseBackup(b).ok).toBe(true);
      Object.assign(b.settings, { targetStocks: 1, targetGold: 0, targetClouds: 0, targetCash: 0 });
      expect(parseBackup(b).ok).toBe(true);
      Object.assign(b.settings, { targetStocks: 0.33333, targetGold: 0.33333, targetClouds: 0.33334, targetCash: 0 });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("insight thresholds (user_settings_insight_thresholds_check) and reminder switches", () => {
    rejects([
      ["a negative percent", (b) => (b.settings.insightMinPercent = -0.01), "settings: insightMinPercent must be between 0 and 10"],
      ["a percent beyond the column", (b) => (b.settings.insightMinPercent = 10), "settings: insightMinPercent must be between 0 and 10"],
      ["a percent with 5 decimals", (b) => (b.settings.insightMinPercent = 0.15001), "settings.insightMinPercent: must have at most 4 decimals"],
      ["a negative amount", (b) => (b.settings.insightMinAmount = -1), "settings: insightMinPercent must be between 0 and 10"],
      ["a fractional amount", (b) => (b.settings.insightMinAmount = 500.5), "settings.insightMinAmount: must be a whole number of piasters"],
      ["a switch that is not a boolean", (b) => (b.settings.remindGoal = "yes" as never), "settings.remindGoal"],
      ["a missing switch", (b) => delete (b.settings as Partial<typeof b.settings>).remindSavings, "settings.remindSavings"],
      ["a missing percent", (b) => delete (b.settings as Partial<typeof b.settings>).insightMinPercent, "settings.insightMinPercent"],
    ]);

    it("accepts a percent and an amount of zero", () => {
      const b = valid();
      Object.assign(b.settings, { insightMinPercent: 0, insightMinAmount: 0 });
      expect(parseBackup(b).ok).toBe(true);
    });
  });

  describe("income growth", () => {
    rejects([["income growth that is not a number", (b) => (b.assumptions.incomeGrowth = "5%" as never), "assumptions.incomeGrowth"]]);

    it("accepts a blank, and a negative growth", () => {
      const b = valid();
      b.assumptions.incomeGrowth = null;
      expect(parseBackup(b).ok).toBe(true);
      b.assumptions.incomeGrowth = -0.1;
      expect(parseBackup(b).ok).toBe(true);
    });
  });
});
