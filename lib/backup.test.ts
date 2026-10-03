import { describe, expect, it } from "vitest";
import { accountType, categoryKind, transactionStatus, transactionType } from "../db/schema";
import {
  ACCOUNT_TYPES,
  CATEGORY_KINDS,
  insertOrder,
  parseBackup,
  serializeBackup,
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
const at = (s: string) => new Date(s);

// Shaped like Drizzle rows, user_id included, to prove it never reaches the file.
const base = { userId: "user-1", createdAt: at("2026-03-01T08:00:00.000Z") };
const rows = {
  settings: { monthStartDay: 25 },
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
    expect([ACCOUNT_TYPES, CATEGORY_KINDS, TX_TYPES, TX_STATUSES]).toEqual([
      accountType.enumValues,
      categoryKind.enumValues,
      transactionType.enumValues,
      transactionStatus.enumValues,
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
      ["unknown version", (b) => (b.version = 2 as never), "version: 2 is not supported"],
      ["missing version", (b) => delete b.version, "version: undefined"],
      ["accounts not a list", (b) => (b.accounts = {} as never), "accounts: must be a list"],
      ["transactions missing", (b) => delete b.transactions, "transactions: must be a list"],
      ["settings missing", (b) => delete b.settings, "settings: must be an object"],
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
