"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { listCloudRecords, listHoldingEvents } from "@/db/queries";
import { accounts, corporateActionKind, corporateActions, holdings, priceUpdates, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { validateCloudHistory } from "@/lib/finance-core/clouds";
import { lineValue } from "@/lib/finance-core/holdings";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { dividendCash, type HoldingEvent, purchaseCash, saleCash, validateHistory } from "@/lib/finance-core/portfolio";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, str } from "./shared";

const NOT_FOUND = "Holding not found.";
const ARCHIVED = "This holding is archived. Restore it first.";
const CLOUD = "A Savings Cloud takes deposits and withdrawals, not units. Use its own actions.";
const GOLD = "Gold has no dividends and is priced from the gold prices, not per holding.";
const ACCOUNT_ERROR = "Account not found.";
const MONEY_ERROR = "Enter an amount like 1,250.50 (up to 2 decimals, no minus sign).";
const QUANTITY_ERROR = "Enter a quantity above zero with up to 6 decimals, like 25 or 12.5.";
const PRICE_ERROR = "Enter a price per unit of zero or more with up to 6 decimals, like 84.25.";
const DATE_ERROR = "Enter a valid date.";
const NOTE_ERROR = "Note is too long (500 characters at most).";
const MAX_NOTE = 500;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Holding = typeof holdings.$inferSelect;

// A refusal raised inside a database transaction: it rolls the transaction back and becomes the action's error.
class Refused extends Error {}

const refuse = (message: string): never => {
  throw new Refused(message);
};

// Quantity, price and ratio are NUMERIC(20,6): plain digits, at most 14 whole and 6 decimal places. Never Number().
// ponytail: same pattern as the engine's private parser in finance-core/holdings.ts; export one from there if a third copy appears.
const DECIMAL = /^\d{1,14}(\.\d{1,6})?$/;
const isZero = (d: string) => !/[1-9]/.test(d);

const decimal = (formData: FormData, key: string): string | null => {
  const v = str(formData, key);
  return DECIMAL.test(v) ? v : null;
};

/** Piasters from a typed amount; a blank field is 0 when optional. null when it is not an amount. */
function money(formData: FormData, key: string, optional: boolean): Piasters | null {
  const text = str(formData, key);
  return text === "" && optional ? 0 : parseEGP(text);
}

/** The engine's own validation errors (RangeError) are readable messages; anything else propagates. */
function engineError(e: unknown): ActionState {
  if (e instanceof RangeError) return { error: e.message };
  throw e;
}

/**
 * Runs `work` in one database transaction that holds this holding's row lock, so two writes to the same
 * holding take turns and each one validates against the history the other left behind. These actions are
 * unit-based (gold's unit is the gram); a cloud is refused unless the caller says it handles clouds.
 */
async function mutate(
  userId: string,
  holdingId: string | null,
  work: (tx: Tx, holding: Holding) => Promise<void>,
  allowCloud = false,
): Promise<ActionState> {
  if (!holdingId) return { error: NOT_FOUND };
  try {
    await db.transaction(async (tx) => {
      const [holding] = await tx
        .select()
        .from(holdings)
        .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)))
        .for("update");
      if (!holding) return refuse(NOT_FOUND);
      if (holding.archivedAt) return refuse(ARCHIVED);
      if (holding.kind === "cloud" && !allowCloud) return refuse(CLOUD);
      await work(tx, holding);
    });
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    throw e;
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

/** Rule F: refuse when replaying the holding's history (plus `add`) makes any position impossible on any date. */
async function assertHistory(tx: Tx, userId: string, holdingId: string, add?: HoldingEvent, lead?: string): Promise<void> {
  const events = await listHoldingEvents(userId, holdingId, tx);
  const check = validateHistory(add ? [...events, add] : events);
  // Generic text: the engine's message names the quantity held, which privacy mode could not hide.
  if (!check.ok) refuse(`${lead ? `${lead}: ` : ""}you would not hold enough units on ${check.date}.`);
}

type Common = { date: string; note: string | null; accountId: string | null };

function readCommon(formData: FormData): Common | string {
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return DATE_ERROR;
  // No amounts in the note: notes render as plain text, which privacy mode does not hide.
  const note = str(formData, "note");
  if (note.length > MAX_NOTE) return NOTE_ERROR;
  return { date, note: note || null, accountId: id(formData, "accountId") };
}

/** Buy: amount = quantity x unit price + fee, taken from the cash account. The fee goes into cost basis. */
export async function buyHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const quantity = decimal(formData, "quantity");
  if (quantity === null || isZero(quantity)) return { error: QUANTITY_ERROR };
  const unitPrice = decimal(formData, "unitPrice");
  if (unitPrice === null) return { error: PRICE_ERROR };
  const fee = money(formData, "fee", true);
  if (fee === null) return { error: MONEY_ERROR };
  const common = readCommon(formData);
  if (typeof common === "string") return { error: common };

  let amount: Piasters;
  try {
    amount = purchaseCash(quantity, unitPrice, fee);
  } catch (e) {
    return engineError(e);
  }

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    const accountId = await requireAccount(tx, userId, common.accountId);
    const createdAt = new Date();
    await assertHistory(tx, userId, holding.id, {
      type: "purchase",
      date: common.date,
      createdAt: createdAt.toISOString(),
      quantity,
      price: unitPrice,
      fee,
    });
    await tx.insert(transactions).values({
      userId,
      type: "INVESTMENT_PURCHASE",
      date: common.date,
      amount,
      fromAccountId: accountId,
      holdingId: holding.id,
      quantity,
      unitPrice,
      fee,
      note: common.note,
      createdAt,
    });
  });
}

/** Sell: amount = net cash received (quantity x price - fee - tax withheld); gross_amount = quantity x price. */
export async function sellHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const quantity = decimal(formData, "quantity");
  if (quantity === null || isZero(quantity)) return { error: QUANTITY_ERROR };
  const unitPrice = decimal(formData, "unitPrice");
  if (unitPrice === null) return { error: PRICE_ERROR };
  const fee = money(formData, "fee", true);
  const tax = money(formData, "taxWithheld", true);
  if (fee === null || tax === null) return { error: MONEY_ERROR };
  const common = readCommon(formData);
  if (typeof common === "string") return { error: common };

  let amount: Piasters;
  let grossAmount: Piasters;
  try {
    amount = saleCash(quantity, unitPrice, fee, tax);
    grossAmount = lineValue(quantity, unitPrice);
  } catch (e) {
    return engineError(e);
  }

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    const accountId = await requireAccount(tx, userId, common.accountId);
    const createdAt = new Date();
    await assertHistory(tx, userId, holding.id, {
      type: "sale",
      date: common.date,
      createdAt: createdAt.toISOString(),
      quantity,
      price: unitPrice,
      fee,
      tax,
    });
    await tx.insert(transactions).values({
      userId,
      type: "INVESTMENT_SALE",
      date: common.date,
      amount,
      toAccountId: accountId,
      holdingId: holding.id,
      quantity,
      unitPrice,
      fee,
      taxWithheld: tax,
      grossAmount,
      note: common.note,
      createdAt,
    });
  });
}

/** Dividend: gross and tax withheld typed, net = gross - tax lands in the account. Counts as investment income. */
export async function recordDividend(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const gross = money(formData, "gross", false);
  const tax = money(formData, "taxWithheld", true);
  if (gross === null || tax === null) return { error: MONEY_ERROR };
  const common = readCommon(formData);
  if (typeof common === "string") return { error: common };

  let amount: Piasters;
  try {
    amount = dividendCash(gross, tax);
  } catch (e) {
    return engineError(e);
  }

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    if (holding.kind === "gold") refuse(GOLD);
    const accountId = await requireAccount(tx, userId, common.accountId);
    const createdAt = new Date();
    await assertHistory(tx, userId, holding.id, {
      type: "dividend",
      date: common.date,
      createdAt: createdAt.toISOString(),
      gross,
      tax,
    });
    await tx.insert(transactions).values({
      userId,
      type: "DIVIDEND",
      date: common.date,
      amount,
      toAccountId: accountId,
      holdingId: holding.id,
      grossAmount: gross,
      taxWithheld: tax,
      note: common.note,
      createdAt,
    });
  });
}

type ActionKind = (typeof corporateActionKind.enumValues)[number];

/** BONUS adds units, SPLIT multiplies them by a ratio (below 1 is a reverse split), WRITE_OFF zeroes them. No cash moves. */
export async function addCorporateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const kind = str(formData, "kind") as ActionKind;
  if (!corporateActionKind.enumValues.includes(kind)) return { error: "Choose bonus, split or write-off." };

  let quantity: string | null = null;
  let ratio: string | null = null;
  if (kind === "BONUS") {
    quantity = decimal(formData, "quantity");
    if (quantity === null || isZero(quantity)) return { error: "Enter the bonus units, above zero with up to 6 decimals." };
  } else if (kind === "SPLIT") {
    ratio = decimal(formData, "ratio");
    if (ratio === null || isZero(ratio)) return { error: "Enter the split ratio above zero, like 2 for 2-for-1 or 0.5 for a reverse split." };
  }
  const common = readCommon(formData);
  if (typeof common === "string") return { error: common };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    const createdAt = new Date();
    const at = { date: common.date, createdAt: createdAt.toISOString() };
    await assertHistory(
      tx,
      userId,
      holding.id,
      kind === "BONUS" ? { ...at, type: "bonus", quantity: quantity! } : kind === "SPLIT" ? { ...at, type: "split", ratio: ratio! } : { ...at, type: "writeOff" },
    );
    await tx
      .insert(corporateActions)
      .values({ userId, holdingId: holding.id, kind, date: common.date, quantity, ratio, note: common.note, createdAt });
  });
}

/** Appends a price. Never edits one: a wrong price is fixed by adding a newer update for the same date. */
export async function addPriceUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const price = decimal(formData, "price");
  if (price === null) return { error: PRICE_ERROR };
  const date = str(formData, "date") || cairoToday();
  if (!isRealDate(date)) return { error: DATE_ERROR };
  if (date > cairoToday()) return { error: "A price cannot be dated in the future." };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    if (holding.kind === "gold") refuse(GOLD);
    await tx.insert(priceUpdates).values({ userId, holdingId: holding.id, date, price, createdAt: new Date() });
  });
}

/**
 * Voids a buy, sell, dividend, or a cloud deposit or withdrawal. Refused if the position would go impossible on any
 * date, or (a cloud) if a withdrawal would end up larger than the estimated value.
 */
export async function voidInvestmentTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  if (!txId) return { error: "Transaction not found." };

  const [row] = await db
    .select({ holdingId: transactions.holdingId })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)));
  if (!row?.holdingId) return { error: "Investment transaction not found." };

  return mutate(userId, row.holdingId, async (tx, holding) => {
    const voided = await tx
      .update(transactions)
      .set({ status: "void", voidedAt: new Date() })
      .where(and(eq(transactions.id, txId), eq(transactions.userId, userId), ne(transactions.status, "void")))
      .returning({ id: transactions.id });
    if (voided.length === 0) refuse("Transaction not found or already voided.");
    // Checked after the update so the replay already leaves this row out; a refusal rolls the update back.
    if (holding.kind === "cloud") {
      if (!validateCloudHistory(await listCloudRecords(userId, holding.id, tx)).ok) {
        refuse("Voiding this would leave a withdrawal larger than the cloud's estimated value.");
      }
    } else {
      await assertHistory(tx, userId, holding.id, undefined, "Voiding this would leave an impossible position");
    }
  }, true);
}
