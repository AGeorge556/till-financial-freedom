"use server";

import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { essentialMonthlyTotals, getSettings } from "@/db/queries";
import { goalAllocations, goals, goalTargetMode } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { emergencyTarget } from "@/lib/finance-core/goals";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, NAME_ERROR, str, validName } from "./shared";

const NOT_FOUND = "Goal not found.";
const AMOUNT_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign).";
const RETURN_ERROR = "Enter the expected return as a percent between -100 and 1000, like 12 or 7.5.";
const MAX_PRIORITY = 1000;
const MAX_TARGET_MONTHS = 60;

type Mode = (typeof goalTargetMode.enumValues)[number];

// targetAmount is null only for an expense_months goal with no fallback typed; withTarget fills it in.
type ParsedFields = Pick<
  typeof goals.$inferInsert,
  | "name"
  | "targetDate"
  | "startDate"
  | "priority"
  | "plannedMonthly"
  | "expectedReturnOverride"
  | "notes"
  | "color"
  | "icon"
> & { manualCurrent: Piasters | null; targetAmount: Piasters | null; targetMode: Mode; targetMonths: number | null };
type Fields = ParsedFields & { targetAmount: Piasters };

/** "12" or "-7.5" (a percent, up to 4 decimals) to the stored rate string "0.120000"; null if malformed or outside min..max percent. */
function percentToRate(text: string, min: number, max: number): string | null {
  const m = /^(-)?(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const micro = Number(m[2] + (m[3] ?? "").padEnd(4, "0")); // percent x 10,000 = rate x 1,000,000
  if (micro > max * 10_000 || (m[1] && micro > -min * 10_000)) return null;
  const sign = m[1] && micro > 0 ? "-" : "";
  return `${sign}${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`;
}

function optionalEGP(text: string): Piasters | null | string {
  if (text === "") return null;
  return parseEGP(text) ?? AMOUNT_ERROR;
}

/** Shape and format checks only; ownership is checked against the database. */
function parseFields(formData: FormData, startFallback: string | undefined): ParsedFields | string {
  const name = str(formData, "name");
  if (!validName(name)) return NAME_ERROR;

  const targetMode = (str(formData, "targetMode") || "manual") as Mode;
  if (!goalTargetMode.enumValues.includes(targetMode)) return "Choose a fixed target or a number of months of essential spending.";
  let targetMonths: number | null = null;
  if (targetMode === "expense_months") {
    const monthsText = str(formData, "targetMonths");
    targetMonths = /^\d{1,2}$/.test(monthsText) ? Number(monthsText) : 0;
    if (targetMonths < 1 || targetMonths > MAX_TARGET_MONTHS) return `Enter the months of essential spending to cover, from 1 to ${MAX_TARGET_MONTHS}.`;
  }
  // An expense_months goal may leave the amount blank: it is then the target as it works out today (see withTarget).
  const targetText = str(formData, "targetAmount");
  const blankTarget = targetMode === "expense_months" && targetText === "";
  const targetAmount = blankTarget ? null : parseEGP(targetText);
  if (!blankTarget && (targetAmount === null || targetAmount === 0)) return "Enter a target amount greater than zero, like 50,000.";

  const targetDate = str(formData, "targetDate");
  const startDate = str(formData, "startDate") || startFallback;
  if (!isRealDate(targetDate)) return "Enter a valid target date.";
  if (!startDate || !isRealDate(startDate)) return "Enter a valid start date.";
  if (targetDate < startDate) return "The target date must be on or after the start date.";

  const priorityText = str(formData, "priority");
  const priority = /^\d{1,4}$/.test(priorityText) ? Number(priorityText) : 0;
  if (priority < 1 || priority > MAX_PRIORITY) return `Priority is a whole number from 1 (highest) to ${MAX_PRIORITY}.`;

  const plannedMonthly = optionalEGP(str(formData, "plannedMonthly"));
  if (typeof plannedMonthly === "string") return plannedMonthly;
  const manualCurrent = optionalEGP(str(formData, "manualCurrent"));
  if (typeof manualCurrent === "string") return manualCurrent;

  const returnText = str(formData, "expectedReturn");
  const expectedReturnOverride = returnText === "" ? null : percentToRate(returnText, -100, 1000);
  if (returnText !== "" && expectedReturnOverride === null) return RETURN_ERROR;

  const notes = str(formData, "notes");
  const color = str(formData, "color");
  const icon = str(formData, "icon");
  if (notes.length > 1000) return "Notes are too long (1,000 characters at most).";
  if (color.length > 32 || icon.length > 32) return "Color and icon must be 32 characters or fewer.";

  return {
    name,
    targetAmount,
    targetMode,
    targetMonths,
    targetDate,
    startDate,
    priority,
    plannedMonthly,
    expectedReturnOverride,
    manualCurrent,
    notes: notes || null,
    color: color || null,
    icon: icon || null,
  };
}

/**
 * goals.target_amount cannot be empty, so an expense_months goal saved without a fallback stores the target as it works
 * out now, which needs at least one full month of history. The target shown later is recalculated, not this figure.
 */
async function withTarget(userId: string, fields: ParsedFields): Promise<Fields | string> {
  if (fields.targetAmount !== null) return { ...fields, targetAmount: fields.targetAmount };
  const { monthStartDay } = await getSettings(userId);
  const result = emergencyTarget({
    months: fields.targetMonths!,
    essentialMonthlyTotals: await essentialMonthlyTotals(userId, cairoToday(), monthStartDay),
  });
  if (result.kind === "target" && result.target > 0) return { ...fields, targetAmount: result.target };
  return "There is not enough essential spending history to work out this target yet. Enter a target amount to use until there is.";
}

export async function createGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const parsed = parseFields(formData, cairoToday());
  if (typeof parsed === "string") return { error: parsed };
  const fields = await withTarget(userId, parsed);
  if (typeof fields === "string") return { error: fields };

  await db.insert(goals).values({ ...fields, userId });
  revalidatePath("/", "layout");
  return {};
}

export async function updateGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const goalId = id(formData, "id");
  if (!goalId) return { error: NOT_FOUND };
  const parsed = parseFields(formData, undefined);
  if (typeof parsed === "string") return { error: parsed };
  const fields = await withTarget(userId, parsed);
  if (typeof fields === "string") return { error: fields };

  const error = await db.transaction(async (tx) => {
    const [goal] = await tx
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
      .for("update");
    if (!goal) return NOT_FOUND;

    const [{ n }] = await tx
      .select({ n: count() })
      .from(goalAllocations)
      .where(and(eq(goalAllocations.goalId, goalId), eq(goalAllocations.userId, userId)));
    if (n > 0 && fields.manualCurrent !== null) {
      return "This goal has allocations, so its current amount comes from them. Clear the manual amount.";
    }

    await tx
      .update(goals)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

async function setArchived(formData: FormData, archived: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const goalId = id(formData, "id");
  if (!goalId) return { error: NOT_FOUND };

  const updated = await db
    .update(goals)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(
      and(eq(goals.id, goalId), eq(goals.userId, userId), archived ? isNull(goals.archivedAt) : isNotNull(goals.archivedAt)),
    )
    .returning({ id: goals.id });
  if (updated.length === 0) return { error: NOT_FOUND };
  revalidatePath("/", "layout");
  return {};
}

export async function archiveGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, true);
}

export async function unarchiveGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, false);
}
