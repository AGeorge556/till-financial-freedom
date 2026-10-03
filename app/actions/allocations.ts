"use server";

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { toLedgerTx } from "@/db/queries";
import { accounts, goalAllocationEvents, goalAllocations, goals, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { validateAllocationChange } from "@/lib/finance-core/goals";
import { accountBalance } from "@/lib/finance-core/ledger";
import { parseEGP } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, str } from "./shared";

/**
 * Earmarks `amount` of a cash account for a goal (0 removes it). Never writes a transaction and never changes
 * a balance. No amounts in the messages: they render as plain text, which privacy mode does not hide.
 */
export async function setAllocation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const goalId = id(formData, "goalId");
  const accountId = id(formData, "accountId");
  if (!goalId) return { error: "Goal not found." };
  if (!accountId) return { error: "Account not found." };
  const next = parseEGP(str(formData, "amount"));
  if (next === null) return { error: "Enter an amount like 1,250.50, or 0 to remove the allocation." };

  const error = await db.transaction(async (tx) => {
    // FOR UPDATE on the account serialises concurrent changes to anything earmarked on it.
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .for("update");
    if (!account) return "Account not found.";
    const [goal] = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
      .for("update"); // updateGoal locks the goal too, so a manual amount cannot slip in beside allocations
    if (!goal) return "Goal not found.";
    if (account.isInvestment) return "Goals can only be funded from cash accounts, not investment accounts.";
    if (account.type === "credit_card" || account.type === "receivable") {
      return "Goals can only be funded from money you hold, not from a credit card or money owed to you.";
    }

    const onAccount = await tx
      .select()
      .from(goalAllocations)
      .where(and(eq(goalAllocations.accountId, accountId), eq(goalAllocations.userId, userId)));
    const existing = onAccount.find((a) => a.goalId === goalId);
    const current = existing?.amount ?? 0;
    if (next === current) return;
    // Archived goals and accounts can release money but not take more.
    if (next > current && (goal.archivedAt || account.archivedAt)) {
      return "Archived goals and accounts cannot be given more money. Restore it first.";
    }

    const rows = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          or(eq(transactions.fromAccountId, accountId), eq(transactions.toAccountId, accountId)),
        ),
      );
    const balance = accountBalance(account.openingBalance, accountId, rows.map(toLedgerTx));
    const total = onAccount.reduce((sum, a) => sum + a.amount, 0);
    const check = validateAllocationChange(balance, total, current, next);
    if (!check.ok) {
      return check.error === "invalid-amount"
        ? "That amount is too large."
        : "That is more than the free balance on this account. Enter a smaller amount.";
    }

    if (next === 0) {
      await tx.delete(goalAllocations).where(eq(goalAllocations.id, existing!.id));
    } else if (existing) {
      await tx.update(goalAllocations).set({ amount: next, updatedAt: new Date() }).where(eq(goalAllocations.id, existing.id));
    } else {
      await tx.insert(goalAllocations).values({ userId, goalId, accountId, amount: next });
    }
    await tx.insert(goalAllocationEvents).values({ userId, goalId, accountId, delta: next - current, date: cairoToday() });
    if (next > 0) {
      await tx.update(goals).set({ manualCurrent: null, updatedAt: new Date() }).where(eq(goals.id, goalId));
    }
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}
