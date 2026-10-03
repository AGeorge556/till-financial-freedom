"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { type CloudRecords, listCloudRecords } from "@/db/queries";
import { accounts, cloudConfirmations, contributionFrequency, holdings, rateHistory, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { cloudEstimate, validateCloudHistory, validateWithdrawal } from "@/lib/finance-core/clouds";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, str } from "./shared";

const NOT_FOUND = "Savings Cloud not found.";
const ARCHIVED = "This cloud is archived. Restore it first.";
const ACCOUNT_ERROR = "Account not found.";
const MONEY_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign), above zero.";
const DATE_ERROR = "Enter a valid date.";
const FUTURE_ERROR = "A cloud record cannot be dated in the future.";
const NOTE_ERROR = "Note is too long (500 characters at most).";
const APY_ERROR = "Enter the APY as a percent above -100 and up to 1000, like 20 or 7.5.";
const HISTORY_ERROR = "That would leave a withdrawal larger than the cloud's estimated value at the time.";
const MAX_NOTE = 500;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Holding = typeof holdings.$inferSelect;

// A refusal raised inside a database transaction: it rolls the transaction back and becomes the action's error.
class Refused extends Error {}

const refuse = (message: string): never => {
  throw new Refused(message);
};

// Only the constraint names this file can trip, translated; anything else is a bug and propagates.
const KNOWN_VIOLATIONS: Record<string, string> = {
  rate_history_apy_check: APY_ERROR,
  cloud_confirmations_value_check: "The confirmed value cannot be negative.",
  holdings_cloud_values_check: "Check the maturity date and the contribution.",
};

function knownViolation(e: unknown): string | undefined {
  const name = (e as { cause?: { constraint_name?: string } })?.cause?.constraint_name;
  return name ? KNOWN_VIOLATIONS[name] : undefined;
}

// ponytail: same conversion as goals.ts and assumptions.ts (a "use server" file cannot export it); move to shared.ts (this is the third copy, with liabilities.ts and allocations.ts making five).
/** "20" or "-7.5" (a percent, up to 4 decimals) to the stored rate string "0.200000"; null outside -100 (exclusive) .. 1000 percent. */
function apyToRate(text: string): string | null {
  const m = /^(-)?(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const micro = Number(m[2] + (m[3] ?? "").padEnd(4, "0")); // percent x 10,000 = rate x 1,000,000
  if (micro > 1000 * 10_000 || (m[1] && micro >= 100 * 10_000)) return null;
  const sign = m[1] && micro > 0 ? "-" : "";
  return `${sign}${Math.trunc(micro / 1e6)}.${String(micro % 1e6).padStart(6, "0")}`;
}

/**
 * Runs `work` in one database transaction that holds this cloud's row lock, with its records read inside it, so two
 * writes to the same cloud take turns and each one validates against what the other left behind.
 */
async function mutate(
  userId: string,
  holdingId: string | null,
  work: (tx: Tx, holding: Holding, records: CloudRecords) => Promise<void>,
): Promise<ActionState> {
  if (!holdingId) return { error: NOT_FOUND };
  try {
    await db.transaction(async (tx) => {
      const [holding] = await tx
        .select()
        .from(holdings)
        .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)))
        .for("update");
      if (!holding || holding.kind !== "cloud") return refuse(NOT_FOUND);
      if (holding.archivedAt) return refuse(ARCHIVED);
      await work(tx, holding, await listCloudRecords(userId, holding.id, tx));
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

/** The cash account must be the signed-in user's own and still active. */
async function requireAccount(tx: Tx, userId: string, accountId: string | null): Promise<string> {
  const [account] = accountId
    ? await tx
        .select({ id: accounts.id, archivedAt: accounts.archivedAt })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    : [];
  return account && !account.archivedAt ? account.id : refuse(ACCOUNT_ERROR);
}

type Flow = { amount: Piasters; date: string; note: string | null; accountId: string | null };

function readFlow(formData: FormData): Flow | string {
  const amount = parseEGP(str(formData, "amount"));
  if (amount === null || amount === 0) return MONEY_ERROR;
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return DATE_ERROR;
  if (date > cairoToday()) return FUTURE_ERROR;
  // No amounts in the note: notes render as plain text, which privacy mode does not hide.
  const note = str(formData, "note");
  if (note.length > MAX_NOTE) return NOTE_ERROR;
  return { amount, date, note: note || null, accountId: id(formData, "accountId") };
}

/** Refuses a record set (a back-dated entry, a new rate or confirmation) that leaves a withdrawal larger than the estimate before it. */
function assertHistory(records: CloudRecords): void {
  if (!validateCloudHistory(records).ok) refuse(HISTORY_ERROR);
}

/** Deposit: cash leaves the account and goes into the cloud. Investing, not spending; no quantity or unit price. */
export async function depositToCloud(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const flow = readFlow(formData);
  if (typeof flow === "string") return { error: flow };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding, records) => {
    const accountId = await requireAccount(tx, userId, flow.accountId);
    const createdAt = new Date();
    assertHistory({
      ...records,
      cashFlows: [...records.cashFlows, { date: flow.date, createdAt: createdAt.toISOString(), kind: "deposit", amount: flow.amount }],
    });
    await tx.insert(transactions).values({
      userId,
      type: "INVESTMENT_PURCHASE",
      date: flow.date,
      amount: flow.amount,
      fromAccountId: accountId,
      holdingId: holding.id,
      note: flow.note,
      createdAt,
    });
  });
}

/** Withdrawal: refused above the estimated value on its date, and above what any later withdrawal still needs. */
export async function withdrawFromCloud(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const flow = readFlow(formData);
  if (typeof flow === "string") return { error: flow };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding, records) => {
    const accountId = await requireAccount(tx, userId, flow.accountId);
    const check = validateWithdrawal(flow.amount, cloudEstimate({ ...records, asOf: flow.date }).value);
    if (!check.ok) refuse(check.error === "invalid-amount" ? MONEY_ERROR : "That is more than the cloud's estimated value on that date.");
    const createdAt = new Date();
    assertHistory({
      ...records,
      cashFlows: [...records.cashFlows, { date: flow.date, createdAt: createdAt.toISOString(), kind: "withdrawal", amount: flow.amount }],
    });
    await tx.insert(transactions).values({
      userId,
      type: "INVESTMENT_SALE",
      date: flow.date,
      amount: flow.amount,
      toAccountId: accountId,
      holdingId: holding.id,
      note: flow.note,
      createdAt,
    });
  });
}

/** Appends an APY (effective annual rate, typed as a percent) from an effective date. Never edits one. */
export async function addRateChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const apy = apyToRate(str(formData, "apy"));
  if (apy === null) return { error: APY_ERROR };
  const effectiveDate = str(formData, "effectiveDate") || cairoToday();
  if (!isRealDate(effectiveDate)) return { error: DATE_ERROR };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding, records) => {
    const createdAt = new Date();
    assertHistory({ ...records, rates: [...records.rates, { date: effectiveDate, createdAt: createdAt.toISOString(), apy: Number(apy) }] });
    await tx.insert(rateHistory).values({ userId, holdingId: holding.id, effectiveDate, apy, createdAt });
  });
}

/** The actual value the user read off the product. It becomes the new anchor of the estimate. */
export async function confirmCloudValue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const value = parseEGP(str(formData, "value"));
  if (value === null) return { error: "Enter the value like 1,250.50, or 0 if nothing is left." };
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return { error: DATE_ERROR };
  if (date > cairoToday()) return { error: FUTURE_ERROR };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding, records) => {
    const createdAt = new Date();
    assertHistory({ ...records, confirmations: [...records.confirmations, { date, createdAt: createdAt.toISOString(), value }] });
    await tx.insert(cloudConfirmations).values({ userId, holdingId: holding.id, date, value, createdAt });
  });
}

/** Start and maturity dates and the contribution (used for projections only; it never books money). */
export async function updateCloud(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const startDate = str(formData, "startDate");
  if (!isRealDate(startDate)) return { error: "Enter the date the cloud started." };
  const maturity = str(formData, "maturityDate");
  if (maturity && !isRealDate(maturity)) return { error: "Enter a valid maturity date, or leave it blank." };
  if (maturity && maturity < startDate) return { error: "The maturity date must be on or after the start date." };
  const amountText = str(formData, "contributionAmount");
  const frequencyText = str(formData, "contributionFrequency");
  const frequency = frequencyText as (typeof contributionFrequency.enumValues)[number];
  if ((amountText === "") !== (frequencyText === "")) return { error: "Enter both a contribution and how often, or neither." };
  let contributionAmount: Piasters | null = null;
  if (amountText !== "") {
    contributionAmount = parseEGP(amountText);
    if (contributionAmount === null || contributionAmount === 0) return { error: "Enter a contribution like 1,250.50, above zero." };
    if (!contributionFrequency.enumValues.includes(frequency)) return { error: "Choose weekly or monthly." };
  }

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    await tx
      .update(holdings)
      .set({
        startDate,
        maturityDate: maturity || null,
        contributionAmount,
        contributionFrequency: contributionAmount === null ? null : frequency,
        updatedAt: new Date(),
      })
      .where(and(eq(holdings.id, holding.id), eq(holdings.userId, userId)));
  });
}
