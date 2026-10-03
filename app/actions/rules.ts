"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { allocationOverrides, allocationRuleKind, allocationRules, allocationTargetKind, goals } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { parseEGP } from "@/lib/finance-core/money";
import { type ActionState, id, str } from "./shared";

const NOT_FOUND = "Rule not found.";
const SECOND_REMAINDER = "Only one rule can take the remainder. Change or delete the existing one first.";
const AMOUNT_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign).";
const PERCENT_ERROR = "Enter a percent above 0 and up to 100, like 20 or 12.5.";

type RuleKind = (typeof allocationRuleKind.enumValues)[number];
type TargetKind = (typeof allocationTargetKind.enumValues)[number];
type Fields = { kind: RuleKind; targetKind: TargetKind; goalId: string | null; amount: number | null; percent: string | null };

/** "12.5" (a percent, up to 4 decimals) to the stored rate string "0.125000"; null if malformed or not in (0, 100]. */
function percentToRate(text: string): string | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const micro = Number(m[1] + (m[2] ?? "").padEnd(4, "0")); // percent x 10,000 = rate x 1,000,000
  if (micro === 0 || micro > 1_000_000) return null;
  return `${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`;
}

/** Shape checks, same as the allocation_rules CHECK constraints; the goal's ownership is checked in the transaction. */
function parseFields(formData: FormData): Fields | string {
  const kind = str(formData, "kind") as RuleKind;
  const targetKind = str(formData, "targetKind") as TargetKind;
  if (!allocationRuleKind.enumValues.includes(kind)) return "Choose fixed, percentage or remainder.";
  if (!allocationTargetKind.enumValues.includes(targetKind)) return "Choose a goal, investments or cash.";

  const goalId = id(formData, "goalId");
  if (targetKind === "goal" && !goalId) return "Choose a goal.";

  let amount: number | null = null;
  let percent: string | null = null;
  if (kind === "fixed") {
    amount = parseEGP(str(formData, "amount"));
    if (amount === null || amount === 0) return "Enter an amount above zero, like 1,250.50.";
  } else if (kind === "percentage") {
    percent = percentToRate(str(formData, "percent"));
    if (percent === null) return PERCENT_ERROR;
  }
  return { kind, targetKind, goalId: targetKind === "goal" ? goalId : null, amount, percent };
}

// Drizzle wraps the driver error in `cause`; only the known unique index becomes a message.
function isSecondRemainder(e: unknown): boolean {
  const err = ((e as { cause?: unknown })?.cause ?? e) as { code?: string; constraint_name?: string };
  return err.code === "23505" && err.constraint_name === "allocation_rules_one_remainder_idx";
}

async function save(ruleId: string | null, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const fields = parseFields(formData);
  if (typeof fields === "string") return { error: fields };

  try {
    const error = await db.transaction(async (tx) => {
      if (fields.goalId) {
        const [goal] = await tx
          .select({ id: goals.id })
          .from(goals)
          .where(and(eq(goals.id, fields.goalId), eq(goals.userId, userId)));
        if (!goal) return "Goal not found.";
      }
      if (fields.kind === "remainder") {
        const others = await tx
          .select({ id: allocationRules.id })
          .from(allocationRules)
          .where(
            and(
              eq(allocationRules.userId, userId),
              eq(allocationRules.kind, "remainder"),
              ruleId ? ne(allocationRules.id, ruleId) : undefined,
            ),
          );
        if (others.length > 0) return SECOND_REMAINDER;
      }
      if (!ruleId) {
        await tx.insert(allocationRules).values({ ...fields, userId });
        return;
      }
      const updated = await tx
        .update(allocationRules)
        .set(fields)
        .where(and(eq(allocationRules.id, ruleId), eq(allocationRules.userId, userId)))
        .returning({ id: allocationRules.id });
      if (updated.length === 0) return NOT_FOUND;
    });
    if (error) return { error };
  } catch (e) {
    if (isSecondRemainder(e)) return { error: SECOND_REMAINDER };
    throw e;
  }
  revalidatePath("/", "layout");
  return {};
}

export async function addRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return save(null, formData);
}

export async function updateRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ruleId = id(formData, "id");
  if (!ruleId) return { error: NOT_FOUND };
  return save(ruleId, formData);
}

/** Rules are configuration, so this is a hard delete (its monthly overrides go with it). */
export async function deleteRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const ruleId = id(formData, "id");
  if (!ruleId) return { error: NOT_FOUND };

  const deleted = await db
    .delete(allocationRules)
    .where(and(eq(allocationRules.id, ruleId), eq(allocationRules.userId, userId)))
    .returning({ id: allocationRules.id });
  if (deleted.length === 0) return { error: NOT_FOUND };
  revalidatePath("/", "layout");
  return {};
}

/** Replaces the rule's amount for one financial month ('YYYY-MM' of its start); the rule itself is not edited. */
export async function setOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const ruleId = id(formData, "ruleId");
  const month = str(formData, "month");
  if (!ruleId) return { error: NOT_FOUND };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Choose a month." };
  const amount = parseEGP(str(formData, "amount"));
  if (amount === null) return { error: AMOUNT_ERROR };

  const error = await db.transaction(async (tx) => {
    const [rule] = await tx
      .select({ id: allocationRules.id })
      .from(allocationRules)
      .where(and(eq(allocationRules.id, ruleId), eq(allocationRules.userId, userId)))
      .for("update");
    if (!rule) return NOT_FOUND;
    await tx
      .insert(allocationOverrides)
      .values({ userId, ruleId, month, amount })
      .onConflictDoUpdate({ target: [allocationOverrides.ruleId, allocationOverrides.month], set: { amount } });
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

export async function clearOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const ruleId = id(formData, "ruleId");
  const month = str(formData, "month");
  if (!ruleId) return { error: NOT_FOUND };

  await db
    .delete(allocationOverrides)
    .where(
      and(eq(allocationOverrides.ruleId, ruleId), eq(allocationOverrides.month, month), eq(allocationOverrides.userId, userId)),
    );
  revalidatePath("/", "layout");
  return {};
}
