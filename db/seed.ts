import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { egpToPiasters } from "../lib/finance-core/money";
import { cairoToday } from "../lib/finance-core/time";
import { accounts, categories, transactions, userSettings } from "./schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local; rely on the process environment
}

const userId = process.env.SEED_USER_ID;
const url = process.env.DATABASE_URL;
if (!userId || !url) throw new Error("SEED_USER_ID and DATABASE_URL are required.");

const EXPENSE_CATEGORIES = [
  "Food", "Restaurants", "Groceries", "Transportation", "Fuel", "Bills", "Utilities", "Phone", "Internet",
  "Subscriptions", "Entertainment", "Shopping", "Clothing", "Healthcare", "Personal", "Giving", "Family",
  "Travel", "Education", "Other",
];
const ESSENTIAL = new Set([
  "Groceries", "Food", "Transportation", "Fuel", "Bills", "Utilities", "Phone", "Internet", "Healthcare",
]);
const INCOME_CATEGORIES = ["Salary", "Freelance", "Bonus", "Dividends", "Interest", "Other"];

const today = cairoToday();
const month = today.slice(0, 7);
const dayOf = (d: number) => `${month}-${String(Math.min(d, Number(today.slice(8)))).padStart(2, "0")}`;

const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client);

// .then chain, not top-level await: tsx runs this as CJS (package.json has no "type": "module").
db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(accounts).where(eq(accounts.userId, userId));
    if (n > 0) {
      console.log("User already has accounts; seed skipped.");
      return;
    }

    await tx.insert(userSettings).values({ userId });

    const accountRows = await tx
      .insert(accounts)
      .values([
        { userId, name: "CIB Bank", type: "bank", institution: "CIB", openingBalance: egpToPiasters(40000) },
        { userId, name: "Cash", type: "cash", openingBalance: egpToPiasters(2000) },
        { userId, name: "Thndr", type: "brokerage", institution: "Thndr", isInvestment: true },
      ])
      .returning({ id: accounts.id, name: accounts.name });
    const acct = Object.fromEntries(accountRows.map((a) => [a.name, a.id]));

    const categoryRows = await tx
      .insert(categories)
      .values([
        ...EXPENSE_CATEGORIES.map((name) => ({
          userId, name, kind: "expense" as const, isEssential: ESSENTIAL.has(name),
        })),
        ...INCOME_CATEGORIES.map((name) => ({ userId, name, kind: "income" as const })),
      ])
      .returning({ id: categories.id, name: categories.name, kind: categories.kind });
    const cat = (kind: "income" | "expense", name: string) =>
      categoryRows.find((c) => c.kind === kind && c.name === name)!.id;

    await tx.insert(transactions).values([
      { userId, type: "INCOME", date: dayOf(1), amount: egpToPiasters(25000), toAccountId: acct["CIB Bank"], categoryId: cat("income", "Salary"), note: "Monthly salary" },
      { userId, type: "EXPENSE", date: dayOf(2), amount: egpToPiasters(3200), fromAccountId: acct["CIB Bank"], categoryId: cat("expense", "Groceries"), note: "Weekly groceries" },
      { userId, type: "EXPENSE", date: dayOf(3), amount: egpToPiasters(450), fromAccountId: acct["Cash"], categoryId: cat("expense", "Restaurants") },
      { userId, type: "EXPENSE", date: dayOf(4), amount: egpToPiasters(600), fromAccountId: acct["CIB Bank"], categoryId: cat("expense", "Fuel") },
      { userId, type: "EXPENSE", date: dayOf(5), amount: egpToPiasters(1200), fromAccountId: acct["CIB Bank"], categoryId: cat("expense", "Bills"), note: "Electricity" },
      { userId, type: "EXPENSE", date: dayOf(6), amount: egpToPiasters(250), fromAccountId: acct["CIB Bank"], categoryId: cat("expense", "Phone") },
      { userId, type: "EXPENSE", date: dayOf(7), amount: egpToPiasters(199), fromAccountId: acct["CIB Bank"], categoryId: cat("expense", "Subscriptions") },
      { userId, type: "TRANSFER", date: dayOf(8), amount: egpToPiasters(5000), fromAccountId: acct["CIB Bank"], toAccountId: acct["Thndr"], note: "Fund brokerage" },
      { userId, type: "ADJUSTMENT", date: dayOf(9), amount: egpToPiasters(-75), toAccountId: acct["Cash"], note: "Cash count correction" },
      { userId, type: "EXPENSE", date: dayOf(10), amount: egpToPiasters(850), fromAccountId: acct["CIB Bank"], categoryId: cat("expense", "Shopping"), status: "pending", note: "Awaiting card settlement" },
    ]);

    console.log("Seeded user_settings, 3 accounts, 26 categories, 10 transactions.");
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
