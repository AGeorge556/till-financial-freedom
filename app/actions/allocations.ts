"use server";

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { holdingValueNow, listHoldingAllocations, toLedgerTx } from "@/db/queries";
import { accounts, goalAllocationEvents, goalAllocations, goals, holdings, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { shareChangeEvent, validateAllocationChange, validateShareChange } from "@/lib/finance-core/goals";
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
    const total = onAccount.reduce((sum, a) => sum + (a.amount ?? 0), 0);
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

// ponytail: same conversion as goals.ts and assumptions.ts (a "use server" file cannot export it); move to shared.ts if it is copied again.
/** "25" or "12.5" (a percent, up to 4 decimals, 0 to 100) to the stored share string "0.250000"; null if malformed or above 100. */
function percentToShare(text: string): string | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const micro = Number(m[1] + (m[2] ?? "").padEnd(4, "0")); // percent x 10,000 = share x 1,000,000
  if (micro > 100 * 10_000) return null;
  return `${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`;
}

// Shares are numeric(8,6), so Postgres hands them back as "0.250000": whole millionths add up exactly.
// ponytail: goals.ts has no sum helper yet; move this there next to validateShareChange if the data loader needs one too.
const millionths = (share: string) => Number(share.replace(".", ""));
const sumShares = (shares: string[]) => {
  const total = shares.reduce((sum, p) => sum + millionths(p), 0);
  return `${Math.trunc(total / 1e6)}.${String(total % 1e6).padStart(6, "0")}`;
};

/**
 * Earmarks a percentage share of a holding (stock, fund, gold or cloud) for a goal, 0 removes it. The goal's value
 * from it is share x the holding's current value, so it moves with the market. Never moves money; the event records
 * the share change and its EGP value at this moment. No amounts in the messages: they render as plain text.
 */
export async function setHoldingShare(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const goalId = id(formData, "goalId");
  const holdingId = id(formData, "holdingId");
  if (!goalId) return { error: "Goal not found." };
  if (!holdingId) return { error: "Holding not found." };
  const next = percentToShare(str(formData, "percent"));
  if (next === null) return { error: "Enter a share like 25 (a percent of the holding, up to 100), or 0 to remove it." };

  const error = await db.transaction(async (tx) => {
    // FOR UPDATE on the holding serialises concurrent changes to every goal's share of it.
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)))
      .for("update");
    if (!holding) return "Holding not found.";
    const [goal] = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
      .for("update"); // updateGoal locks the goal too, so a manual amount cannot slip in beside allocations
    if (!goal) return "Goal not found.";

    const shares = await listHoldingAllocations(userId, holdingId, tx);
    const existing = shares.find((a) => a.goalId === goalId);
    const current = existing?.percent ?? "0";
    if (millionths(next) === millionths(current)) return;
    const increase = millionths(next) > millionths(current);
    // Archived goals and holdings can release a share but not take more.
    if (increase && (goal.archivedAt || holding.archivedAt)) {
      return "Archived goals and holdings cannot be given more. Restore it first.";
    }
    const check = validateShareChange(sumShares(shares.map((a) => a.percent!)), current, next);
    if (!check.ok) {
      return check.error === "invalid-percent"
        ? "Enter a share from 0 to 100 percent."
        : "That is more than the part of this holding no goal has claimed. Enter a smaller share.";
    }

    const event = shareChangeEvent(current, next, await holdingValueNow(userId, holding, cairoToday(), tx));
    // An event needs a non-zero EGP value; a worthless holding can release a share but not take one.
    if (increase && (event === null || event.delta === 0)) return "This holding has no value yet, so a share of it cannot be earmarked.";

    if (millionths(next) === 0) {
      await tx.delete(goalAllocations).where(eq(goalAllocations.id, existing!.id));
    } else if (existing) {
      await tx.update(goalAllocations).set({ percent: next, updatedAt: new Date() }).where(eq(goalAllocations.id, existing.id));
    } else {
      await tx.insert(goalAllocations).values({ userId, goalId, holdingId, percent: next });
    }
    if (event && event.delta !== 0) {
      await tx
        .insert(goalAllocationEvents)
        .values({ userId, goalId, holdingId, percentDelta: event.percentDelta, delta: event.delta, date: cairoToday() });
    }
    if (millionths(next) > 0) {
      await tx.update(goals).set({ manualCurrent: null, updatedAt: new Date() }).where(eq(goals.id, goalId));
    }
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}
