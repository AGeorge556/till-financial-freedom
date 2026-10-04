"use server";

import { and, count, eq, isNull, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { accounts, accountType, goalAllocations, holdings, transactions } from "@/db/schema";
import { db } from "@/db";
import { toLedgerTx } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { replacementStamp } from "@/lib/corrections";
import { accountBalance, validateAccountChange } from "@/lib/finance-core/ledger";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, flag, id, isRealDate, NAME_ERROR, str, type Tx, validName } from "./shared";

const AMOUNT_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign).";
const OWED_ERROR = "Owed only applies to credit card accounts.";
const NOT_FOUND = "Account not found.";

type AccountType = (typeof accountType.enumValues)[number];
type AccountRow = typeof accounts.$inferSelect;

/** Typed amount to signed piasters. A negative balance is only possible via "owed" on a credit card. */
function parseBalance(text: string, owed: boolean, type: AccountType): Piasters | string {
  const amount = parseEGP(text);
  if (amount === null) return AMOUNT_ERROR;
  if (owed && type !== "credit_card") return OWED_ERROR;
  return owed && amount !== 0 ? -amount : amount;
}

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const name = str(formData, "name");
  const type = str(formData, "type") as AccountType;
  if (!validName(name)) return { error: NAME_ERROR };
  if (!accountType.enumValues.includes(type)) return { error: "Choose an account type." };

  const opening = parseBalance(str(formData, "openingBalance") || "0", flag(formData, "owed"), type);
  if (typeof opening === "string") return { error: opening };

  await db.insert(accounts).values({
    userId,
    name,
    type,
    institution: str(formData, "institution") || null,
    notes: str(formData, "notes") || null,
    isInvestment: type === "brokerage" || flag(formData, "isInvestment"),
    openingBalance: opening,
  });
  revalidatePath("/", "layout");
  return {};
}

type Next = { type: AccountType; openingBalance: Piasters; isInvestment: boolean };

const CHANGE_ERRORS = {
  "negative-opening": OWED_ERROR,
  "holdings-need-investment": "This account holds investments, so it must stay an investment account.",
  "earmarks-exceed-balance": "Goals have money set aside on this account, so its balance cannot go below that.",
} as const;

/** Every ledger row that touches the account (void and pending included; the engine skips what is not posted). */
function accountLedger(tx: Tx, userId: string, accountId: string) {
  return tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), or(eq(transactions.fromAccountId, accountId), eq(transactions.toAccountId, accountId))));
}

/** What goals have earmarked on the account, in piasters. */
async function allocatedOn(tx: Tx, userId: string, accountId: string): Promise<Piasters> {
  const rows = await tx
    .select({ amount: goalAllocations.amount })
    .from(goalAllocations)
    .where(and(eq(goalAllocations.userId, userId), eq(goalAllocations.accountId, accountId)));
  return rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
}

/** Opening balance, type and investment flag may change only if every rule that holds for the account still holds. */
async function checkChange(tx: Tx, userId: string, account: AccountRow, next: Next): Promise<string | undefined> {
  const ledger = (await accountLedger(tx, userId, account.id)).map(toLedgerTx);
  const [held] = await tx
    .select({ n: count() })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.accountId, account.id)));
  const allocated = await allocatedOn(tx, userId, account.id);
  const check = validateAccountChange({
    ...next,
    holdingsOnAccount: held.n,
    allocatedOnAccount: allocated,
    balanceBefore: accountBalance(account.openingBalance, account.id, ledger),
    balanceAfter: accountBalance(next.openingBalance, account.id, ledger),
  });
  if (!check.ok) return CHANGE_ERRORS[check.error];
  // setAllocation never earmarks an investment account, a credit card or money owed to you: keep that true.
  const becomesNoGoals = (next.isInvestment && !account.isInvestment) || (NO_GOALS.includes(next.type) && next.type !== account.type);
  if (becomesNoGoals && allocated > 0) return "Goals have money set aside on this account. Remove those first.";
}

const NO_GOALS: AccountType[] = ["credit_card", "receivable"];

/**
 * Name, institution and notes always. When the form also sends a type (with its opening balance, "owed" and
 * "isInvestment" checkbox) those change too: refused if it would break a rule the account already satisfies.
 */
export async function updateAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const accountId = id(formData, "id");
  const name = str(formData, "name");
  if (!accountId) return { error: NOT_FOUND };
  if (!validName(name)) return { error: NAME_ERROR };
  const retype = formData.has("type");
  const type = str(formData, "type") as AccountType;
  if (retype && !accountType.enumValues.includes(type)) return { error: "Choose an account type." };
  const opening = retype ? parseBalance(str(formData, "openingBalance") || "0", flag(formData, "owed"), type) : null;
  if (typeof opening === "string") return { error: opening };

  const error = await db.transaction(async (tx) => {
    // FOR UPDATE: a balance set, allocation or holding on this account waits, so the checks below cannot go stale.
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .for("update");
    if (!account) return NOT_FOUND;
    let change: Next | null = null;
    if (opening !== null) {
      change = { type, openingBalance: opening, isInvestment: type === "brokerage" || flag(formData, "isInvestment") };
      const refused = await checkChange(tx, userId, account, change);
      if (refused) return refused;
    }
    await tx
      .update(accounts)
      .set({
        name,
        institution: str(formData, "institution") || null,
        notes: str(formData, "notes") || null,
        ...change,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, account.id));
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

async function setArchived(formData: FormData, archived: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const accountId = id(formData, "id");
  if (!accountId) return { error: NOT_FOUND };

  const updated = await db
    .update(accounts)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId),
        archived ? isNull(accounts.archivedAt) : isNotNull(accounts.archivedAt),
      ),
    )
    .returning({ id: accounts.id });
  if (updated.length === 0) return { error: NOT_FOUND };
  revalidatePath("/", "layout");
  return {};
}

export async function archiveAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, true);
}

export async function unarchiveAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, false);
}

/** Records an ADJUSTMENT for the difference; there is no stored balance to overwrite. */
export async function setBalance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const accountId = id(formData, "id");
  if (!accountId) return { error: NOT_FOUND };
  const text = str(formData, "balance");
  const owed = flag(formData, "owed");

  const error = await db.transaction(async (tx) => {
    // FOR UPDATE serialises two concurrent balance sets on the same account.
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .for("update");
    if (!account) return NOT_FOUND;

    const target = parseBalance(text, owed, account.type);
    if (typeof target === "string") return target;

    const rows = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          or(eq(transactions.fromAccountId, accountId), eq(transactions.toAccountId, accountId)),
        ),
      );
    const current = accountBalance(account.openingBalance, accountId, rows.map(toLedgerTx));
    const difference = target - current;
    if (difference === 0) return;
    if (!Number.isSafeInteger(difference)) return "That amount is too large.";

    await tx.insert(transactions).values({
      userId,
      type: "ADJUSTMENT",
      date: cairoToday(),
      amount: difference,
      toAccountId: accountId,
      // No amount in the note: notes render as plain text, which privacy mode does not hide.
      note: "Balance set manually",
    });
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

const ADJUSTMENT_NOT_FOUND = "Balance adjustment not found or already removed.";

/**
 * Edit (replace = true: new date and note, same amount) or remove (false) a "Set balance" adjustment. Its amount is
 * corrected by setting the balance again. Removing it lowers the balance, so it is refused if goals have earmarked
 * more on the account than the balance would then be (an account that was already over-allocated may not get worse).
 */
async function correctAdjustment(formData: FormData, replace: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const rowId = id(formData, "id");
  const date = replace ? str(formData, "date") || cairoToday() : "";
  if (replace && !isRealDate(date)) return { error: "Enter a valid date." };
  // No amount in the note: notes render as plain text, which privacy mode does not hide.
  const note = replace ? str(formData, "note") : "";
  if (note.length > 500) return { error: "Note is too long (500 characters at most)." };
  const [row] = rowId
    ? await db
        .select({ accountId: transactions.toAccountId })
        .from(transactions)
        .where(and(eq(transactions.id, rowId), eq(transactions.userId, userId), eq(transactions.type, "ADJUSTMENT")))
    : [];
  if (!rowId || !row?.accountId) return { error: ADJUSTMENT_NOT_FOUND };

  const error = await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, row.accountId!), eq(accounts.userId, userId)))
      .for("update");
    if (!account) return NOT_FOUND;
    const [old] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, rowId),
          eq(transactions.userId, userId),
          eq(transactions.type, "ADJUSTMENT"),
          eq(transactions.toAccountId, account.id),
          eq(transactions.status, "posted"),
        ),
      )
      .for("update");
    if (!old) return ADJUSTMENT_NOT_FOUND;
    if (!replace) {
      const rows = await accountLedger(tx, userId, account.id);
      const check = validateAccountChange({
        type: account.type,
        isInvestment: account.isInvestment,
        openingBalance: account.openingBalance,
        holdingsOnAccount: 0, // the type and flag do not change here
        allocatedOnAccount: await allocatedOn(tx, userId, account.id),
        balanceBefore: accountBalance(account.openingBalance, account.id, rows.map(toLedgerTx)),
        balanceAfter: accountBalance(account.openingBalance, account.id, rows.filter((r) => r.id !== old.id).map(toLedgerTx)),
      });
      if (!check.ok) return "Goals have money set aside on this account, so this adjustment cannot be removed.";
    }
    await tx.update(transactions).set({ status: "void", voidedAt: new Date() }).where(eq(transactions.id, old.id));
    if (replace) {
      await tx.insert(transactions).values({
        userId,
        type: "ADJUSTMENT",
        date,
        amount: old.amount,
        toAccountId: account.id,
        note: note || null,
        replacesId: old.id,
        createdAt: replacementStamp(old, date),
      });
    }
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

export async function editAdjustment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctAdjustment(formData, true);
}

export async function voidAdjustment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctAdjustment(formData, false);
}
