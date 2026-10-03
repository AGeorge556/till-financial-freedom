"use server";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { generateDueRecurring } from "@/db/queries";
import { accounts, categories, recurringFrequency, recurringTemplates, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { parseEGP } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, flag, id, isRealDate, NAME_ERROR, str, validName } from "./shared";

const NOT_FOUND = "Recurring item not found.";
const PENDING_NOT_FOUND = "This item is not waiting for confirmation, or it was already handled.";
const AMOUNT_ERROR = "Enter an amount above zero, like 1,250.50 (up to 2 decimals, no minus sign).";
const DATE_ERROR = "Enter a valid date.";
const MAX_NOTE = 500;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Frequency = (typeof recurringFrequency.enumValues)[number];
type Fields = {
  name: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  categoryId: string;
  accountId: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  autoPost: boolean;
  note: string | null;
};

/** Shape and format checks only; ownership is checked against the database by checkRefs. */
function parseFields(formData: FormData, startFallback: string): Fields | string {
  const name = str(formData, "name");
  if (!validName(name)) return NAME_ERROR;
  const type = str(formData, "type");
  if (type !== "INCOME" && type !== "EXPENSE") return "Choose income or expense.";
  const amount = parseEGP(str(formData, "amount"));
  if (amount === null || amount === 0) return AMOUNT_ERROR;
  const categoryId = id(formData, "categoryId");
  if (!categoryId) return "Choose a category.";
  const accountId = id(formData, "accountId");
  if (!accountId) return type === "INCOME" ? "Choose the account the money goes to." : "Choose the account the money comes from.";
  const frequency = str(formData, "frequency") as Frequency;
  if (!recurringFrequency.enumValues.includes(frequency)) return "Choose weekly, monthly or yearly.";
  const startDate = str(formData, "startDate") || startFallback;
  if (!isRealDate(startDate)) return DATE_ERROR;
  const endText = str(formData, "endDate");
  if (endText !== "" && !isRealDate(endText)) return DATE_ERROR;
  if (endText !== "" && endText < startDate) return "The end date must be on or after the start date.";
  // No amounts in notes: they render as plain text, which privacy mode does not hide.
  const note = str(formData, "note");
  if (note.length > MAX_NOTE) return `Note is too long (${MAX_NOTE} characters at most).`;
  return { name, type, amount, categoryId, accountId, frequency, startDate, endDate: endText || null, autoPost: flag(formData, "autoPost"), note: note || null };
}

/** The Drizzle connection bypasses RLS, so the ids from the client must belong to this user and fit the item's type. */
async function checkRefs(tx: Tx, userId: string, f: Fields): Promise<string | undefined> {
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, f.accountId), eq(accounts.userId, userId), isNull(accounts.archivedAt)));
  if (!account) return "Account not found, or it is archived.";
  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, f.categoryId),
        eq(categories.userId, userId),
        eq(categories.kind, f.type === "INCOME" ? "income" : "expense"),
        isNull(categories.archivedAt),
      ),
    );
  if (!category) return "Category not found, or it is the wrong kind for this item.";
}

export async function createTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const fields = parseFields(formData, cairoToday());
  if (typeof fields === "string") return { error: fields };

  const error = await db.transaction(async (tx) => {
    const refError = await checkRefs(tx, userId, fields);
    if (refError) return refError;
    await tx.insert(recurringTemplates).values({ ...fields, userId });
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Changes affect future occurrences only. Whatever is already due is generated first, under the old terms, and rows
 * already generated are never touched (a pending one can be adjusted when it is confirmed). A different frequency or
 * start date is a new schedule, so it must start after today: moved back, it would generate the past all over again.
 */
export async function updateTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const templateId = id(formData, "id");
  if (!templateId) return { error: NOT_FOUND };

  const today = cairoToday();
  const error = await db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(recurringTemplates)
      .where(and(eq(recurringTemplates.id, templateId), eq(recurringTemplates.userId, userId)))
      .for("update");
    if (!old) return NOT_FOUND;
    const fields = parseFields(formData, old.startDate);
    if (typeof fields === "string") return fields;
    if ((fields.frequency !== old.frequency || fields.startDate !== old.startDate) && fields.startDate <= today) {
      return "A new schedule has to start after today. Set a start date in the future; what was already due stays as it is.";
    }
    const refError = await checkRefs(tx, userId, fields);
    if (refError) return refError;

    await generateDueRecurring(userId, { templateId, tx, today });
    await tx
      .update(recurringTemplates)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(recurringTemplates.id, templateId), eq(recurringTemplates.userId, userId)));
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Pausing first generates what is already due. Resuming creates the gap as pending rows, even for an auto-post item:
 * nothing posts money for a period the item was switched off. Skip the ones that should not count.
 */
export async function setTemplateActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const templateId = id(formData, "id");
  if (!templateId) return { error: NOT_FOUND };
  const active = flag(formData, "active");

  const error = await db.transaction(async (tx) => {
    const [template] = await tx
      .select({ active: recurringTemplates.active })
      .from(recurringTemplates)
      .where(and(eq(recurringTemplates.id, templateId), eq(recurringTemplates.userId, userId)))
      .for("update");
    if (!template) return NOT_FOUND;
    if (template.active === active) return;
    if (!active) await generateDueRecurring(userId, { templateId, tx });
    await tx
      .update(recurringTemplates)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(recurringTemplates.id, templateId), eq(recurringTemplates.userId, userId)));
    if (active) await generateDueRecurring(userId, { templateId, tx, forcePending: true });
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

/**
 * One tap: a pending row becomes posted, with the amount and date it was generated with unless adjusted here.
 * The row is updated in place, which is the one exception to void-and-replace: a pending row has changed no balance yet,
 * and a replacement would collide with the (template, due date) the original holds.
 */
export async function confirmRecurring(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  if (!txId) return { error: PENDING_NOT_FOUND };
  const amountText = str(formData, "amount");
  const adjusted = amountText === "" ? null : parseEGP(amountText);
  if (amountText !== "" && (adjusted === null || adjusted === 0)) return { error: AMOUNT_ERROR };
  const dateText = str(formData, "date");
  if (dateText !== "" && !isRealDate(dateText)) return { error: DATE_ERROR };

  const posted = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, txId),
          eq(transactions.userId, userId),
          eq(transactions.status, "pending"),
          isNotNull(transactions.recurringTemplateId),
        ),
      )
      .for("update");
    if (!row) return false;
    await tx
      .update(transactions)
      .set({ status: "posted", amount: adjusted ?? row.amount, date: dateText || row.date })
      .where(eq(transactions.id, row.id));
    return true;
  });
  if (!posted) return { error: PENDING_NOT_FOUND };
  revalidatePath("/", "layout");
  return {};
}

/** Voids a pending occurrence. Its due date stays on the void row, so it is never generated again. */
export async function skipRecurring(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  if (!txId) return { error: PENDING_NOT_FOUND };

  const skipped = await db
    .update(transactions)
    .set({ status: "void", voidedAt: new Date() })
    .where(
      and(
        eq(transactions.id, txId),
        eq(transactions.userId, userId),
        eq(transactions.status, "pending"),
        isNotNull(transactions.recurringTemplateId),
      ),
    )
    .returning({ id: transactions.id });
  if (skipped.length === 0) return { error: PENDING_NOT_FOUND };
  revalidatePath("/", "layout");
  return {};
}
