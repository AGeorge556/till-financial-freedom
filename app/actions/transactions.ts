"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { parseEGP } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, str } from "./shared";

const NOT_FOUND = "Transaction not found.";

type Kind = "EXPENSE" | "INCOME" | "TRANSFER";
type Fields = {
  type: Kind;
  amount: number;
  date: string;
  note: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
};
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const isKind = (type: string): type is Kind => type === "EXPENSE" || type === "INCOME" || type === "TRANSFER";

/** Shape and format checks only; ownership is checked against the database by checkRefs. */
function parseFields(type: Kind, formData: FormData): Fields | string {
  const amount = parseEGP(str(formData, "amount"));
  if (amount === null || amount === 0) return "Enter an amount greater than zero, like 1,250.50.";
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return "Enter a valid date.";
  const note = str(formData, "note");
  if (note.length > 500) return "Note is too long (500 characters at most).";

  const from = id(formData, "fromAccountId");
  const to = id(formData, "toAccountId");
  const category = id(formData, "categoryId");
  if (type !== "INCOME" && !from) return "Choose the account the money comes from.";
  if (type !== "EXPENSE" && !to) return "Choose the account the money goes to.";
  if (type !== "TRANSFER" && !category) return "Choose a category.";
  if (type === "TRANSFER" && from === to) return "Choose two different accounts.";

  return {
    type,
    amount,
    date,
    note: note || null,
    fromAccountId: type === "INCOME" ? null : from,
    toAccountId: type === "EXPENSE" ? null : to,
    categoryId: type === "TRANSFER" ? null : category,
  };
}

/** The Drizzle connection bypasses RLS, so every id from the client must belong to this user. */
async function checkRefs(tx: Tx, userId: string, f: Fields): Promise<string | undefined> {
  const accountIds = [...new Set([f.fromAccountId, f.toAccountId].filter((a) => a !== null))];
  const owned = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.id, accountIds)));
  if (owned.length !== accountIds.length) return "Account not found.";

  if (f.categoryId) {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, f.categoryId),
          eq(categories.userId, userId),
          eq(categories.kind, f.type === "INCOME" ? "income" : "expense"),
        ),
      );
    if (!category) return "Category not found, or it is the wrong kind for this transaction.";
  }
}

async function create(type: Kind, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const fields = parseFields(type, formData);
  if (typeof fields === "string") return { error: fields };

  const error = await db.transaction(async (tx) => {
    const refError = await checkRefs(tx, userId, fields);
    if (refError) return refError;
    await tx.insert(transactions).values({ userId, ...fields });
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

export async function addExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return create("EXPENSE", formData);
}

export async function addIncome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return create("INCOME", formData);
}

export async function addTransfer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return create("TRANSFER", formData);
}

/** Void the old row and insert its replacement in one database transaction; the type cannot change. */
export async function editTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  if (!txId) return { error: NOT_FOUND };

  const error = await db.transaction(async (tx) => {
    // FOR UPDATE: a concurrent edit of the same row waits, then sees status 'void' and is refused.
    const [old] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)))
      .for("update");
    if (!old) return NOT_FOUND;
    if (!isKind(old.type) || old.status === "void") return "This transaction cannot be edited.";

    const fields = parseFields(old.type, formData);
    if (typeof fields === "string") return fields;
    const refError = await checkRefs(tx, userId, fields);
    if (refError) return refError;

    await tx.update(transactions).set({ status: "void", voidedAt: new Date() }).where(eq(transactions.id, old.id));
    await tx.insert(transactions).values({ userId, ...fields, status: old.status, replacesId: old.id });
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

export async function voidTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  if (!txId) return { error: NOT_FOUND };

  const voided = await db
    .update(transactions)
    .set({ status: "void", voidedAt: new Date() })
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId), ne(transactions.status, "void")))
    .returning({ id: transactions.id });
  if (voided.length === 0) return { error: "Transaction not found or already voided." };
  revalidatePath("/", "layout");
  return {};
}
