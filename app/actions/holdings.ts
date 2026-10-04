"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { listCloudRecords, listHoldingEvents } from "@/db/queries";
import { accounts, contributionFrequency, goldForm, holdingKind, holdings } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { cloudEstimate } from "@/lib/finance-core/clouds";
import { KARATS } from "@/lib/finance-core/gold";
import { parseEGP } from "@/lib/finance-core/money";
import { replayHolding } from "@/lib/finance-core/portfolio";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, knownViolation, NAME_ERROR, str, validName } from "./shared";

const NOT_FOUND = "Holding not found.";
const MAX_TICKER = 20;
const MAX_NOTES = 1000;

type Kind = (typeof holdingKind.enumValues)[number];

// Only the constraint names this file can trip, translated; anything else is a bug and propagates.
const KNOWN_VIOLATIONS: Record<string, string> = {
  holdings_gold_fields_check: "Gold needs a karat and a form; nothing else has either.",
  holdings_cloud_fields_check: "Only a Savings Cloud has dates and a contribution.",
  holdings_cloud_values_check: "Check the maturity date and the contribution.",
};

type Specific = Pick<
  typeof holdings.$inferInsert,
  "karat" | "form" | "startDate" | "maturityDate" | "contributionAmount" | "contributionFrequency"
>;
const NO_SPECIFIC: Specific = {
  karat: null,
  form: null,
  startDate: null,
  maturityDate: null,
  contributionAmount: null,
  contributionFrequency: null,
};

/** Gold: karat and form. Changing the karat revalues the gold (its buy-back price follows the karat); nothing else depends on it. */
function parseGold(formData: FormData): Specific | string {
  const karatText = str(formData, "karat");
  const form = str(formData, "form") as (typeof goldForm.enumValues)[number];
  const karat = KARATS.find((k) => String(k) === karatText);
  if (karat === undefined) return "Choose 24, 21 or 18 karat.";
  if (!goldForm.enumValues.includes(form)) return "Choose bar, coin or jewelry.";
  return { ...NO_SPECIFIC, karat, form };
}

// ponytail: same cloud-field parsing as clouds.ts updateCloud (a "use server" file cannot export it); move to shared.ts if a third copy appears.
/** Savings Cloud: start date (asked for, though the database does not require it), optional maturity and contribution. */
function parseCloud(formData: FormData): Specific | string {
  const startDate = str(formData, "startDate");
  if (!isRealDate(startDate)) return "Enter the date the cloud started.";
  const maturity = str(formData, "maturityDate");
  if (maturity && !isRealDate(maturity)) return "Enter a valid maturity date, or leave it blank.";
  if (maturity && maturity < startDate) return "The maturity date must be on or after the start date.";
  const amountText = str(formData, "contributionAmount");
  const frequencyText = str(formData, "contributionFrequency");
  const frequency = frequencyText as (typeof contributionFrequency.enumValues)[number];
  if ((amountText === "") !== (frequencyText === "")) return "Enter both a contribution and how often, or neither.";
  let contributionAmount: number | null = null;
  if (amountText !== "") {
    contributionAmount = parseEGP(amountText);
    if (contributionAmount === null || contributionAmount === 0) return "Enter a contribution like 1,250.50, above zero.";
    if (!contributionFrequency.enumValues.includes(frequency)) return "Choose weekly or monthly.";
  }
  return {
    ...NO_SPECIFIC,
    startDate,
    maturityDate: maturity || null,
    contributionAmount,
    contributionFrequency: contributionAmount === null ? null : frequency,
  };
}

/** Name, ticker and notes: what every kind of holding lets you change. */
function parseText(formData: FormData) {
  const name = str(formData, "name");
  const ticker = str(formData, "ticker");
  const notes = str(formData, "notes");
  if (!validName(name)) return NAME_ERROR;
  if (ticker.length > MAX_TICKER) return `Ticker is too long (${MAX_TICKER} characters at most).`;
  if (notes.length > MAX_NOTES) return `Notes are too long (${MAX_NOTES.toLocaleString("en-US")} characters at most).`;
  // No amounts in notes: they render as plain text, which privacy mode does not hide.
  return { name, ticker: ticker || null, notes: notes || null };
}

export async function createHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const kind = str(formData, "kind") as Kind;
  if (!holdingKind.enumValues.includes(kind)) return { error: "Choose stock, fund, gold, Savings Cloud or other." };
  const text = parseText(formData);
  if (typeof text === "string") return { error: text };
  const specific = kind === "gold" ? parseGold(formData) : kind === "cloud" ? parseCloud(formData) : NO_SPECIFIC;
  if (typeof specific === "string") return { error: specific };
  const accountId = id(formData, "accountId");

  let error: string | undefined;
  try {
    error = await db.transaction(async (tx) => {
      const [account] = accountId
        ? await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(
              and(
                eq(accounts.id, accountId),
                eq(accounts.userId, userId),
                eq(accounts.isInvestment, true),
                isNull(accounts.archivedAt),
              ),
            )
        : [];
      if (!account) return "Choose one of your investment accounts, like Thndr.";
      await tx.insert(holdings).values({ userId, accountId: account.id, kind, ...text, ...specific });
    });
  } catch (e) {
    const message = knownViolation(e, KNOWN_VIOLATIONS);
    if (!message) throw e;
    return { error: message };
  }
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Name, ticker and notes, and the details fixed at creation: gold's karat and form, a Savings Cloud's start and maturity
 * dates and contribution. Those are read when the form sends them (karat or form; any cloud field), so a name-only edit
 * leaves them alone.
 */
export async function updateHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const holdingId = id(formData, "id");
  if (!holdingId) return { error: NOT_FOUND };
  const text = parseText(formData);
  if (typeof text === "string") return { error: text };

  let error: string | undefined;
  try {
    error = await db.transaction(async (tx) => {
      const [holding] = await tx
        .select()
        .from(holdings)
        .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)))
        .for("update");
      if (!holding) return NOT_FOUND;
      const sendsGold = formData.has("karat") || formData.has("form");
      const sendsCloud = ["startDate", "maturityDate", "contributionAmount", "contributionFrequency"].some((k) => formData.has(k));
      const specific = holding.kind === "gold" && sendsGold ? parseGold(formData) : holding.kind === "cloud" && sendsCloud ? parseCloud(formData) : {};
      if (typeof specific === "string") return specific;
      await tx
        .update(holdings)
        .set({ ...text, ...specific, updatedAt: new Date() })
        .where(eq(holdings.id, holding.id));
    });
  } catch (e) {
    const message = knownViolation(e, KNOWN_VIOLATIONS);
    if (!message) throw e;
    return { error: message };
  }
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

async function setArchived(formData: FormData, archived: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const holdingId = id(formData, "id");
  if (!holdingId) return { error: NOT_FOUND };

  const error = await db.transaction(async (tx) => {
    // FOR UPDATE: a buy or bonus on this holding waits, so the quantity checked here cannot change under us.
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)))
      .for("update");
    if (!holding || (archived ? holding.archivedAt !== null : holding.archivedAt === null)) return NOT_FOUND;

    if (archived && holding.kind === "cloud") {
      const { value } = cloudEstimate({ ...(await listCloudRecords(userId, holdingId, tx)), asOf: cairoToday() });
      if (value !== 0) return "Withdraw the rest of this cloud, or confirm its value as zero, before archiving it.";
    } else if (archived) {
      const { quantity } = replayHolding(await listHoldingEvents(userId, holdingId, tx));
      if (quantity !== "0") {
        return holding.kind === "gold"
          ? "Sell or write off the remaining gold before archiving this holding."
          : "Sell or write off the remaining units before archiving this holding.";
      }
    }
    await tx
      .update(holdings)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)));
  });
  if (error) return { error };
  revalidatePath("/", "layout");
  return {};
}

export async function archiveHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, true);
}

export async function unarchiveHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setArchived(formData, false);
}
