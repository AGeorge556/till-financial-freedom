"use server";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { listLiabilityTransactions, listLiabilityUpdates, outstandingOf } from "@/db/queries";
import { accounts, categories, liabilities, liabilityKind, liabilityUpdates, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { paymentPair, proposedLiabilityHistory, replacementStamp } from "@/lib/corrections";
import { validateLiabilityHistory } from "@/lib/finance-core/liabilities";
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
const RECORD_NOT_FOUND = "Record not found or already removed.";
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

/** Name, kind, display-only interest rate, start date and notes. The opening balance is read separately (updateLiability). */
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

/**
 * Refuses a history in which the balance would be below zero at the end of any date (the engine replays them in date
 * order), so a payment dated before the borrowing that funds it, and a correction that undoes one, are caught. `change`
 * is applied to the whole history first (a row added, dropped or replaced); `opening` can be a proposed opening balance.
 */
async function checkHistory(
  tx: Tx,
  userId: string,
  liability: Liability,
  change: Parameters<typeof proposedLiabilityHistory>[1] = {},
  opening: Piasters = liability.openingBalance,
): Promise<void> {
  const updates = await listLiabilityUpdates(userId, liability.id, tx);
  const payments = (await listLiabilityTransactions(userId, liability.id, tx))
    .filter((t) => t.type === "LIABILITY_PAYMENT" && t.status === "posted")
    .map((t) => ({ id: t.id, date: t.date, amount: t.amount }));
  const next = proposedLiabilityHistory({ updates, payments }, change);
  const check = validateLiabilityHistory(opening, next.updates, next.payments);
  if (!check.ok) refuse(check.message);
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

/** Name, kind, rate, start date and notes, and (if the form sends one) the opening balance, which must keep the date-ordered balance at zero or more. */
export async function updateLiability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const fields = parseFields(formData);
  if (typeof fields === "string") return { error: fields };
  let opening: Piasters | undefined;
  if (formData.has("openingBalance")) {
    const typed = parseEGP(str(formData, "openingBalance"));
    if (typed === null || typed === 0) return { error: MONEY_ERROR };
    opening = typed;
  }

  return mutate(
    userId,
    id(formData, "id"),
    async (tx, liability) => {
      const changed = opening !== undefined && opening !== liability.openingBalance;
      // An archived loan is at zero; a new opening balance would put it off zero.
      if (changed && liability.archivedAt) refuse("Restore this loan before changing its opening balance.");
      if (changed) await checkHistory(tx, userId, liability, {}, opening);
      await tx
        .update(liabilities)
        .set({ ...fields, ...(changed ? { openingBalance: opening } : {}), updatedAt: new Date() })
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

type Payment = {
  principal: Piasters;
  interest: Piasters;
  date: string;
  note: string | null;
  accountId: string | null;
  categoryId: string | null;
};

/** The payment form: principal above zero, optional interest (which needs an expense category), date and note. */
function parsePayment(formData: FormData): Payment | string {
  const principal = parseEGP(str(formData, "principal"));
  if (principal === null || principal === 0) return MONEY_ERROR;
  const interestText = str(formData, "interest");
  const interest = interestText === "" ? 0 : parseEGP(interestText);
  if (interest === null) return "Enter the interest like 120.50, or leave it blank.";
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return DATE_ERROR;
  const note = str(formData, "note");
  if (note.length > MAX_NOTE) return NOTE_ERROR;
  const categoryId = id(formData, "categoryId");
  if (interest > 0 && !categoryId) return "Choose the expense category for the interest.";
  return { principal, interest, date, note: note || null, accountId: id(formData, "accountId"), categoryId };
}

/** The payment's account and interest category must be the user's own (an edit may keep the archived account it already has). */
async function requirePaymentRefs(tx: Tx, userId: string, p: Payment, keepAccountId?: string | null): Promise<string> {
  const [account] = p.accountId
    ? await tx
        .select({ id: accounts.id, archivedAt: accounts.archivedAt })
        .from(accounts)
        .where(and(eq(accounts.id, p.accountId), eq(accounts.userId, userId)))
    : [];
  if (!account || (account.archivedAt && account.id !== keepAccountId)) return refuse(ACCOUNT_ERROR);
  if (p.interest > 0) {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, p.categoryId!), eq(categories.userId, userId), eq(categories.kind, "expense")));
    if (!category) refuse("Category not found, or it is not an expense category.");
  }
  return account.id;
}

/** The two rows of a payment, written together with one stamp: principal (not spending) and, if any, interest (an expense). */
async function insertPayment(
  tx: Tx,
  userId: string,
  liabilityId: string,
  accountId: string,
  p: Payment,
  createdAt: Date,
  replaces?: { principal: string; interest: string | null },
): Promise<void> {
  const common = { userId, date: p.date, fromAccountId: accountId, liabilityId, note: p.note, createdAt };
  await tx.insert(transactions).values({ ...common, type: "LIABILITY_PAYMENT", amount: p.principal, replacesId: replaces?.principal });
  if (p.interest > 0) {
    await tx
      .insert(transactions)
      .values({ ...common, type: "EXPENSE", amount: p.interest, categoryId: p.categoryId, replacesId: replaces?.interest });
  }
}

/**
 * One payment, one transaction: a LIABILITY_PAYMENT row for the principal (reduces the loan, is not spending) and,
 * if there is interest, an EXPENSE row for it (spending, in the category picked). Both carry liability_id and the
 * same createdAt, which is how voidPayment and editPayment find the pair. Principal cannot exceed the balance outstanding.
 */
export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const payment = parsePayment(formData);
  if (typeof payment === "string") return { error: payment };

  return mutate(userId, id(formData, "liabilityId"), async (tx, liability) => {
    const accountId = await requirePaymentRefs(tx, userId, payment);
    await checkHistory(tx, userId, liability, { addPayment: { date: payment.date, amount: payment.principal } });
    await insertPayment(tx, userId, liability.id, accountId, payment, new Date());
  });
}

/**
 * Corrects a payment, principal and interest together: both old rows are voided and both corrected rows inserted in one
 * transaction. Pass either row of the payment as "id". Refused if the loan's balance would go below zero on any date.
 */
export async function editPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const rowId = id(formData, "id");
  const payment = parsePayment(formData);
  if (typeof payment === "string") return { error: payment };
  const [row] = rowId
    ? await db
        .select({ liabilityId: transactions.liabilityId })
        .from(transactions)
        .where(and(eq(transactions.id, rowId), eq(transactions.userId, userId)))
    : [];
  if (!rowId || !row?.liabilityId) return { error: "Loan payment not found." };

  return mutate(userId, row.liabilityId, async (tx, liability) => {
    const pair = paymentPair(await listLiabilityTransactions(userId, liability.id, tx), rowId);
    if (!pair) return refuse("Payment not found or already voided.");
    const accountId = await requirePaymentRefs(tx, userId, payment, pair.principal.fromAccountId);
    await checkHistory(tx, userId, liability, {
      dropPayments: [pair.principal.id],
      addPayment: { date: payment.date, amount: payment.principal },
    });
    const old = [pair.principal, ...(pair.interest ? [pair.interest] : [])];
    await tx
      .update(transactions)
      .set({ status: "void", voidedAt: new Date() })
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, old.map((r) => r.id)), ne(transactions.status, "void")));
    await insertPayment(tx, userId, liability.id, accountId, payment, replacementStamp(pair.principal, payment.date), {
      principal: pair.principal.id,
      interest: pair.interest?.id ?? null,
    });
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

/** The form of a manual update: how much, owe more or less, when, and a note. */
function parseUpdate(formData: FormData): { delta: Piasters; date: string; note: string | null } | string {
  const amount = parseEGP(str(formData, "amount"));
  if (amount === null || amount === 0) return MONEY_ERROR;
  const direction = str(formData, "direction");
  if (direction !== "more" && direction !== "less") return "Choose whether you owe more or less.";
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return DATE_ERROR;
  const note = str(formData, "note");
  if (note.length > MAX_NOTE) return NOTE_ERROR;
  return { delta: direction === "more" ? amount : -amount, date, note: note || null };
}

/** Borrowed more, or a correction: moves no cash, so it is appended here and never touches an account. */
export async function addLiabilityUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const update = parseUpdate(formData);
  if (typeof update === "string") return { error: update };

  return mutate(userId, id(formData, "liabilityId"), async (tx, liability) => {
    // Owing more can never push a balance below zero; owing less can.
    if (update.delta < 0) await checkHistory(tx, userId, liability, { addUpdate: { date: update.date, delta: update.delta } });
    await tx
      .insert(liabilityUpdates)
      .values({ userId, liabilityId: liability.id, date: update.date, delta: update.delta, note: update.note, createdAt: new Date() });
  });
}

/** Edit (replace = true) or remove (false) a manual update: it is voided, and an edit inserts the corrected one. */
async function correctUpdate(formData: FormData, replace: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const rowId = id(formData, "id");
  const update = replace ? parseUpdate(formData) : null;
  if (typeof update === "string") return { error: update };
  const [parent] = rowId
    ? await db
        .select({ liabilityId: liabilityUpdates.liabilityId })
        .from(liabilityUpdates)
        .where(and(eq(liabilityUpdates.id, rowId), eq(liabilityUpdates.userId, userId)))
    : [];
  if (!rowId || !parent) return { error: RECORD_NOT_FOUND };

  return mutate(userId, parent.liabilityId, async (tx, liability) => {
    const [old] = await tx
      .select()
      .from(liabilityUpdates)
      .where(
        and(
          eq(liabilityUpdates.id, rowId),
          eq(liabilityUpdates.userId, userId),
          eq(liabilityUpdates.liabilityId, liability.id),
          isNull(liabilityUpdates.voidedAt),
        ),
      )
      .for("update");
    if (!old) return refuse(RECORD_NOT_FOUND);
    await checkHistory(tx, userId, liability, {
      dropUpdate: old.id,
      addUpdate: update ? { date: update.date, delta: update.delta } : undefined,
    });
    await tx.update(liabilityUpdates).set({ voidedAt: new Date() }).where(eq(liabilityUpdates.id, old.id));
    if (update) {
      await tx.insert(liabilityUpdates).values({
        userId,
        liabilityId: liability.id,
        date: update.date,
        delta: update.delta,
        note: update.note,
        createdAt: replacementStamp(old, update.date),
      });
    }
  });
}

export async function editLiabilityUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctUpdate(formData, true);
}

export async function removeLiabilityUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctUpdate(formData, false);
}
