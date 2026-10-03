"use server";

import { and, eq, isNull, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { accounts, accountType, transactions } from "@/db/schema";
import { db } from "@/db";
import { toLedgerTx } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { accountBalance } from "@/lib/finance-core/ledger";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, flag, id, NAME_ERROR, str, validName } from "./shared";

const AMOUNT_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign).";
const OWED_ERROR = "Owed only applies to credit card accounts.";
const NOT_FOUND = "Account not found.";

type AccountType = (typeof accountType.enumValues)[number];

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

export async function updateAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const accountId = id(formData, "id");
  const name = str(formData, "name");
  if (!accountId) return { error: NOT_FOUND };
  if (!validName(name)) return { error: NAME_ERROR };

  const updated = await db
    .update(accounts)
    .set({
      name,
      institution: str(formData, "institution") || null,
      notes: str(formData, "notes") || null,
      updatedAt: new Date(),
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .returning({ id: accounts.id });
  if (updated.length === 0) return { error: NOT_FOUND };
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
