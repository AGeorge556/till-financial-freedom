"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { budgets, categories } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { parseEGP } from "@/lib/finance-core/money";
import { type ActionState, id, str } from "./shared";

const AMOUNT_ERROR = "Enter a budget above zero, like 5,000 (up to 2 decimals, no minus sign).";
const CATEGORY_ERROR = "Category not found, or it is not an active expense category.";

/**
 * A standing monthly budget: overall when no category is given, otherwise for that expense category. Setting one that
 * exists changes its amount. No amounts in the messages: they render as plain text, which privacy mode does not hide.
 */
export async function setBudget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const amount = parseEGP(str(formData, "amount"));
  if (amount === null || amount === 0) return { error: AMOUNT_ERROR };
  const categoryId = id(formData, "categoryId");
  if (str(formData, "categoryId") !== "" && !categoryId) return { error: CATEGORY_ERROR };

  const error = await db.transaction(async (tx) => {
    if (categoryId) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.id, categoryId),
            eq(categories.userId, userId),
            eq(categories.kind, "expense"),
            isNull(categories.archivedAt),
          ),
        );
      if (!category) return CATEGORY_ERROR;
    }
    // One overall budget and one per category: the two partial unique indexes are the conflict targets.
    await tx
      .insert(budgets)
      .values({ userId, categoryId, amount })
      .onConflictDoUpdate({
        target: categoryId ? [budgets.userId, budgets.categoryId] : budgets.userId,
        targetWhere: categoryId ? sql`category_id is not null` : sql`category_id is null`,
        set: { amount, updatedAt: new Date() },
      });
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

/** Budgets are standing settings, not ledger history, so removing one deletes the row. */
export async function removeBudget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const budgetId = id(formData, "id");
  if (!budgetId) return { error: "Budget not found." };

  const removed = await db
    .delete(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)))
    .returning({ id: budgets.id });
  if (removed.length === 0) return { error: "Budget not found." };
  revalidatePath("/", "layout");
  return {};
}
