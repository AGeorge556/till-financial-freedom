"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { listLiabilityTransactions, listLiabilityUpdates, outstandingOf } from "@/db/queries";
import { accounts, categories, liabilities, liabilityKind, liabilityUpdates, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { validatePayment } from "@/lib/finance-core/liabilities";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, NAME_ERROR, str, validName } from "./shared";

const NOT_FOUND = "Loan not found.";
const ARCHIVED = "This loan is archived. Restore it first.";
const ACCOUNT_ERROR = "Account not found.";
const MONEY_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign), above zero.";
const DATE_ERROR = "Enter a valid date.";
const NOTE_ERROR = "Note is too long (500 characters at most).";
const RATE_ERROR = "Enter the interest rate as a percent from 0 to 1000, like 18 or 7.5, or leave it blank.";
const MAX_NOTES = 1000;
const MAX_NOTE = 500;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Liability = typeof liabilities.$inferSelect;

// A refusal raised inside a database transaction: it rolls the transaction back and becomes the action's error.
class Refused extends Error {}

const refuse = (message: string): never => {
  throw new Refused(message);
};

// Only the constraint names this file can trip, translated; anything else is a bug and propagates.
const KNOWN_VIOLATIONS: Record<string, string> = {
  liabilities_opening_balance_check: MONEY_ERROR,
  liabilities_interest_rate_check: RATE_ERROR,
  liability_updates_delta_check: MONEY_ERROR,
};

function knownViolation(e: unknown): string | undefined {
  const name = (e as { cause?: { constraint_name?: string } })?.cause?.constraint_name;
  return name ? KNOWN_VIOLATIONS[name] : undefined;
}

// ponytail: same conversion as goals.ts and assumptions.ts (a "use server" file cannot export it); move to shared.ts if it is copied again.
/** "18" or "7.5" (a percent, up to 4 decimals) to the stored rate string "0.180000"; null if malformed or above 1000 percent. */
function percentToRate(text: string): string | null {
  const m = /^(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const micro = Number(m[1] + (m[2] ?? "").padEnd(4, "0")); // percent x 10,000 = rate x 1,000,000
  if (micro > 1000 * 10_000) return null;
  return `${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`;
}

type Kind = (typeof liabilityKind.enumValues)[number];
type Fields = { name: string; kind: Kind; interestRate: string | null; startDate: string; notes: string | null };

/** Name, kind, display-only interest rate, start date and notes. The opening balance is never edited: use an update. */
function parseFields(formData: FormData): Fields | string {
  const name = str(formData, "name");
  if (!validName(name)) return NAME_ERROR;
  const kind = str(formData, "kind") as Kind;
  if (!liabilityKind.enumValues.includes(kind)) return "Choose loan, money owed or other.";
  const rateText = str(formData, "interestRate");
  const interestRate = rateText === "" ? null : percentToRate(rateText);
  if (rateText !== "" && interestRate === null) return RATE_ERROR;
  const startDate = str(formData, "startDate") || cairoToday();
  if (!isRealDate(startDate)) return DATE_ERROR;
  // No amounts in notes: they render as plain text, which privacy mode does not hide.
  const notes = str(formData, "notes");
  if (notes.length > MAX_NOTES) return `Notes are too long (${MAX_NOTES.toLocaleString("en-US")} characters at most).`;
  return { name, kind, interestRate, startDate, notes: notes || null };
}

/**
 * Runs `work` in one database transaction that holds this loan's row lock, so two writes to the same loan take
 * turns and each one validates against the balance the other left behind.
 */
async function mutate(
  userId: string,
  liabilityId: string | null,
  work: (tx: Tx, liability: Liability) => Promise<void>,
  options: { allowArchived?: boolean } = {},
): Promise<ActionState> {
  if (!liabilityId) return { error: NOT_FOUND };
  try {
    await db.transaction(async (tx) => {
      const [liability] = await tx
        .select()
        .from(liabilities)
        .where(and(eq(liabilities.id, liabilityId), eq(liabilities.userId, userId)))
        .for("update");
      if (!liability) return refuse(NOT_FOUND);
      if (liability.archivedAt && !options.allowArchived) return refuse(ARCHIVED);
      await work(tx, liability);
    });
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    const message = knownViolation(e);
    if (!message) throw e;
    return { error: message };
  }
  revalidatePath("/", "layout");
  return {};
}

/** Balance outstanding now, read inside the transaction that holds the lock. */
async function balance(tx: Tx, userId: string, liability: Liability): Promise<Piasters> {
  const updates = await listLiabilityUpdates(userId, liability.id, tx);
  const txs = await listLiabilityTransactions(userId, liability.id, tx);
  return outstandingOf(liability, updates, txs);
}

export async function createLiability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const fields = parseFields(formData);
  if (typeof fields === "string") return { error: fields };
  const openingBalance = parseEGP(str(formData, "openingBalance"));
  if (openingBalance === null || openingBalance === 0) return { error: MONEY_ERROR };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(liabilities).values({ userId, openingBalance, ...fields });
    });
  } catch (e) {
    const message = knownViolation(e);
    if (!message) throw e;
    return { error: message };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function updateLiability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const fields = parseFields(formData);
  if (typeof fields === "string") return { error: fields };

  return mutate(
    userId,
    id(formData, "id"),
    async (tx, liability) => {
      await tx
        .update(liabilities)
        .set({ ...fields, updatedAt: new Date() })
        .where(and(eq(liabilities.id, liability.id), eq(liabilities.userId, userId)));
    },
    { allowArchived: true },
  );
}

async function setArchived(formData: FormData, archived: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  return mutate(
    userId,
    id(formData, "id"),
    async (tx, liability) => {
      if (archived && (await balance(tx, userId, liability)) !== 0) refuse("Pay off the balance before archiving this loan.");
      if (!archived && !liability.archivedAt) refuse(NOT_FOUND);
      await tx
        .update(liabilities)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(liabilities.id, liability.id), eq(liabilities.userId, userId)));
    },
    { allowArchived: !archived },
  );
}

/** Only at zero outstanding. */
export async function archiveLiability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, true);
}

export async function unarchiveLiability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, false);
}

/**
 * One payment, one transaction: a LIABILITY_PAYMENT row for the principal (reduces the loan, is not spending) and,
 * if there is interest, an EXPENSE row for it (spending, in the category picked). Both carry liability_id and the
 * same createdAt, which is how voidPayment finds the pair. Principal cannot exceed the balance outstanding.
 */
export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const principal = parseEGP(str(formData, "principal"));
  if (principal === null || principal === 0) return { error: MONEY_ERROR };
  const interestText = str(formData, "interest");
  const interest = interestText === "" ? 0 : parseEGP(interestText);
  if (interest === null) return { error: "Enter the interest like 120.50, or leave it blank." };
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return { error: DATE_ERROR };
  const note = str(formData, "note");
  if (note.length > MAX_NOTE) return { error: NOTE_ERROR };
  const accountId = id(formData, "accountId");
  const categoryId = id(formData, "categoryId");
  if (interest > 0 && !categoryId) return { error: "Choose the expense category for the interest." };

  return mutate(userId, id(formData, "liabilityId"), async (tx, liability) => {
    const [account] = accountId
      ? await tx
          .select({ id: accounts.id, archivedAt: accounts.archivedAt })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      : [];
    if (!account || account.archivedAt) refuse(ACCOUNT_ERROR);
    if (interest > 0) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId!), eq(categories.userId, userId), eq(categories.kind, "expense")));
      if (!category) refuse("Category not found, or it is not an expense category.");
    }
    const check = validatePayment(principal, interest, await balance(tx, userId, liability));
    if (!check.ok) {
      refuse(check.error === "exceeds-outstanding" ? "That principal is more than the balance outstanding." : MONEY_ERROR);
    }

    const createdAt = new Date();
    const common = { userId, date, fromAccountId: account!.id, liabilityId: liability.id, note: note || null, createdAt };
    await tx.insert(transactions).values({ ...common, type: "LIABILITY_PAYMENT", amount: principal });
    if (interest > 0) await tx.insert(transactions).values({ ...common, type: "EXPENSE", amount: interest, categoryId });
  });
}

/** Borrowed more, or a correction: moves no cash, so it is appended here and never touches an account. */
export async function addLiabilityUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const amount = parseEGP(str(formData, "amount"));
  if (amount === null || amount === 0) return { error: MONEY_ERROR };
  const direction = str(formData, "direction");
  if (direction !== "more" && direction !== "less") return { error: "Choose whether you owe more or less." };
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return { error: DATE_ERROR };
  const note = str(formData, "note");
  if (note.length > MAX_NOTE) return { error: NOTE_ERROR };
  const delta = direction === "more" ? amount : -amount;

  return mutate(userId, id(formData, "liabilityId"), async (tx, liability) => {
    if (delta < 0 && (await balance(tx, userId, liability)) + delta < 0) refuse("That correction is more than the balance outstanding.");
    await tx
      .insert(liabilityUpdates)
      .values({ userId, liabilityId: liability.id, date, delta, note: note || null, createdAt: new Date() });
  });
}

/** Voids a payment: the principal row and its interest row go together, found by their shared loan and timestamp. */
export async function voidPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  if (!txId) return { error: "Transaction not found." };

  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)));
  if (!row?.liabilityId) return { error: "Loan payment not found." };

  return mutate(userId, row.liabilityId, async (tx, liability) => {
    const pair = await tx
      .update(transactions)
      .set({ status: "void", voidedAt: new Date() })
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.liabilityId, liability.id),
          eq(transactions.createdAt, row.createdAt),
          eq(transactions.date, row.date),
          row.fromAccountId ? eq(transactions.fromAccountId, row.fromAccountId) : undefined,
          inArray(transactions.type, ["LIABILITY_PAYMENT", "EXPENSE"]),
          ne(transactions.status, "void"),
        ),
      )
      .returning({ id: transactions.id });
    if (pair.length === 0) refuse("Payment not found or already voided.");
  });
}
