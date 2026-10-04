"use server";

import { and, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { listCloudRecords, listHoldingHistoryRows } from "@/db/queries";
import { accounts, corporateActionKind, corporateActions, holdings, priceUpdates, transactions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { proposedHoldingEvents, replacementStamp } from "@/lib/corrections";
import { validateCloudHistory } from "@/lib/finance-core/clouds";
import { lineValue } from "@/lib/finance-core/holdings";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { dividendCash, purchaseCash, saleCash, validateHistory } from "@/lib/finance-core/portfolio";
import { cairoToday } from "@/lib/finance-core/time";
import { type ActionState, id, isRealDate, knownViolation, Refused, refuse, str, type Tx } from "./shared";

const NOT_FOUND = "Holding not found.";
const TX_NOT_FOUND = "Investment transaction not found.";
const RECORD_NOT_FOUND = "Record not found or already removed.";
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

// Only the constraint names this file can trip, translated; anything else is a bug and propagates.
const KNOWN_VIOLATIONS: Record<string, string> = {
  price_updates_price_check: PRICE_ERROR,
  corporate_actions_kind_values_check: "Check the quantity or ratio.",
  transactions_amount_check: MONEY_ERROR,
  transactions_fee_tax_non_negative_check: MONEY_ERROR,
};

type Holding = typeof holdings.$inferSelect;

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
    const message = knownViolation(e, KNOWN_VIOLATIONS);
    if (!message) throw e;
    return { error: message };
  }
  revalidatePath("/", "layout");
  return {};
}

/** The cash account must be the signed-in user's own and still active (an edit may keep the archived one it already has). */
async function requireAccount(tx: Tx, userId: string, accountId: string | null, keepId?: string | null): Promise<string> {
  const [account] = accountId
    ? await tx
        .select({ id: accounts.id, archivedAt: accounts.archivedAt })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    : [];
  return account && (!account.archivedAt || account.id === keepId) ? account.id : refuse(ACCOUNT_ERROR);
}

/**
 * Rule F: refuse when the holding's history, with `change` applied (a row added, dropped or replaced), makes any position
 * impossible on any date. The history is read inside the transaction, so it is whole and includes no voided row.
 */
async function assertHistory(
  tx: Tx,
  userId: string,
  holdingId: string,
  change: Parameters<typeof proposedHoldingEvents>[1],
  lead?: string,
): Promise<void> {
  const check = validateHistory(proposedHoldingEvents(await listHoldingHistoryRows(userId, holdingId, tx), change));
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

type TradeType = "INVESTMENT_PURCHASE" | "INVESTMENT_SALE" | "DIVIDEND";
const isTradeType = (type: string): type is TradeType =>
  type === "INVESTMENT_PURCHASE" || type === "INVESTMENT_SALE" || type === "DIVIDEND";

type Trade = {
  type: TradeType;
  amount: Piasters;
  quantity: string | null;
  unitPrice: string | null;
  fee: Piasters;
  tax: Piasters | null;
  gross: Piasters | null;
};

/**
 * What a buy, sell or dividend form means, in the columns it writes. Buy: amount = quantity x unit price + fee, taken
 * from the cash account (the fee goes into cost basis). Sell: amount = net cash received (quantity x price - fee - tax
 * withheld), gross = quantity x price. Dividend: net = gross - tax withheld, counted as investment income.
 */
function parseTrade(type: TradeType, formData: FormData): Trade | string {
  if (type === "DIVIDEND") {
    const gross = money(formData, "gross", false);
    const tax = money(formData, "taxWithheld", true);
    if (gross === null || tax === null) return MONEY_ERROR;
    return engine(() => ({ type, amount: dividendCash(gross, tax), quantity: null, unitPrice: null, fee: 0, tax, gross }));
  }
  const quantity = decimal(formData, "quantity");
  if (quantity === null || isZero(quantity)) return QUANTITY_ERROR;
  const unitPrice = decimal(formData, "unitPrice");
  if (unitPrice === null) return PRICE_ERROR;
  const fee = money(formData, "fee", true);
  const tax = type === "INVESTMENT_SALE" ? money(formData, "taxWithheld", true) : null;
  if (fee === null || (type === "INVESTMENT_SALE" && tax === null)) return MONEY_ERROR;
  return engine(() =>
    type === "INVESTMENT_PURCHASE"
      ? { type, amount: purchaseCash(quantity, unitPrice, fee), quantity, unitPrice, fee, tax: null, gross: null }
      : { type, amount: saleCash(quantity, unitPrice, fee, tax!), quantity, unitPrice, fee, tax, gross: lineValue(quantity, unitPrice) },
  );
}

/** The engine's own validation errors (RangeError) are readable messages; anything else propagates. */
function engine<T>(run: () => T): T | string {
  try {
    return run();
  } catch (e) {
    if (e instanceof RangeError) return e.message;
    throw e;
  }
}

/** The ledger columns of a trade: a buy leaves the account, a sell or dividend lands in it. */
const tradeColumns = (t: Trade, accountId: string) => ({
  type: t.type,
  amount: t.amount,
  quantity: t.quantity,
  unitPrice: t.unitPrice,
  fee: t.fee,
  taxWithheld: t.tax,
  grossAmount: t.gross,
  fromAccountId: t.type === "INVESTMENT_PURCHASE" ? accountId : null,
  toAccountId: t.type === "INVESTMENT_PURCHASE" ? null : accountId,
});

async function addTrade(type: TradeType, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const trade = parseTrade(type, formData);
  if (typeof trade === "string") return { error: trade };
  const common = readCommon(formData);
  if (typeof common === "string") return { error: common };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    if (type === "DIVIDEND" && holding.kind === "gold") refuse(GOLD);
    const accountId = await requireAccount(tx, userId, common.accountId);
    const createdAt = new Date();
    const columns = tradeColumns(trade, accountId);
    await assertHistory(tx, userId, holding.id, {
      addTrade: { ...columns, date: common.date, status: "posted", holdingId: holding.id, createdAt },
    });
    await tx
      .insert(transactions)
      .values({ userId, holdingId: holding.id, date: common.date, note: common.note, createdAt, ...columns });
  });
}

export async function buyHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return addTrade("INVESTMENT_PURCHASE", formData);
}

export async function sellHolding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return addTrade("INVESTMENT_SALE", formData);
}

export async function recordDividend(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return addTrade("DIVIDEND", formData);
}

/**
 * Corrects a buy, sell or dividend (units or grams): the old row is voided and the corrected one inserted in the same
 * transaction, only if the holding's whole history with the correction still holds. The type cannot change.
 */
export async function editInvestmentTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  const [row] = txId
    ? await db
        .select({ holdingId: transactions.holdingId, type: transactions.type })
        .from(transactions)
        .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)))
    : [];
  if (!txId || !row?.holdingId || !isTradeType(row.type)) return { error: TX_NOT_FOUND };
  const trade = parseTrade(row.type, formData);
  if (typeof trade === "string") return { error: trade };
  const common = readCommon(formData);
  if (typeof common === "string") return { error: common };

  return mutate(userId, row.holdingId, async (tx, holding) => {
    const [old] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, txId),
          eq(transactions.userId, userId),
          eq(transactions.holdingId, holding.id),
          eq(transactions.status, "posted"),
        ),
      )
      .for("update");
    if (!old) return refuse(TX_NOT_FOUND);
    const accountId = await requireAccount(tx, userId, common.accountId, old.fromAccountId ?? old.toAccountId);
    const createdAt = replacementStamp(old, common.date);
    const columns = tradeColumns(trade, accountId);
    await assertHistory(
      tx,
      userId,
      holding.id,
      { dropTrade: old.id, addTrade: { ...columns, date: common.date, status: "posted", holdingId: holding.id, createdAt } },
      "That change would leave an impossible position",
    );
    await tx.update(transactions).set({ status: "void", voidedAt: new Date() }).where(eq(transactions.id, old.id));
    await tx.insert(transactions).values({
      userId,
      holdingId: holding.id,
      date: common.date,
      note: common.note,
      createdAt,
      replacesId: old.id,
      ...columns,
    });
  });
}

type ActionKind = (typeof corporateActionKind.enumValues)[number];

/** BONUS adds units, SPLIT multiplies them by a ratio (below 1 is a reverse split), WRITE_OFF zeroes them. No cash moves. */
function parseAction(formData: FormData): { kind: ActionKind; quantity: string | null; ratio: string | null } | string {
  const kind = str(formData, "kind") as ActionKind;
  if (!corporateActionKind.enumValues.includes(kind)) return "Choose bonus, split or write-off.";
  let quantity: string | null = null;
  let ratio: string | null = null;
  if (kind === "BONUS") {
    quantity = decimal(formData, "quantity");
    if (quantity === null || isZero(quantity)) return "Enter the bonus units, above zero with up to 6 decimals.";
  } else if (kind === "SPLIT") {
    ratio = decimal(formData, "ratio");
    if (ratio === null || isZero(ratio)) return "Enter the split ratio above zero, like 2 for 2-for-1 or 0.5 for a reverse split.";
  }
  return { kind, quantity, ratio };
}

export async function addCorporateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const action = parseAction(formData);
  if (typeof action === "string") return { error: action };
  const common = readCommon(formData);
  if (typeof common === "string") return { error: common };

  return mutate(userId, id(formData, "holdingId"), async (tx, holding) => {
    const createdAt = new Date();
    const row = { holdingId: holding.id, ...action, date: common.date, createdAt };
    await assertHistory(tx, userId, holding.id, { addAction: row });
    await tx.insert(corporateActions).values({ userId, ...row, note: common.note });
  });
}

/** Edit (replace = true) or remove (false) a corporate action: void it, and for an edit insert the corrected one. */
async function correctAction(formData: FormData, replace: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const rowId = id(formData, "id");
  const action = replace ? parseAction(formData) : null;
  if (typeof action === "string") return { error: action };
  const common = replace ? readCommon(formData) : null;
  if (typeof common === "string") return { error: common };
  const [parent] = rowId
    ? await db
        .select({ holdingId: corporateActions.holdingId })
        .from(corporateActions)
        .where(and(eq(corporateActions.id, rowId), eq(corporateActions.userId, userId)))
    : [];
  if (!rowId || !parent) return { error: RECORD_NOT_FOUND };

  return mutate(userId, parent.holdingId, async (tx, holding) => {
    const [old] = await tx
      .select()
      .from(corporateActions)
      .where(
        and(
          eq(corporateActions.id, rowId),
          eq(corporateActions.userId, userId),
          eq(corporateActions.holdingId, holding.id),
          isNull(corporateActions.voidedAt),
        ),
      )
      .for("update");
    if (!old) return refuse(RECORD_NOT_FOUND);
    const replacement =
      action && common
        ? { holdingId: holding.id, ...action, date: common.date, createdAt: replacementStamp(old, common.date) }
        : undefined;
    await assertHistory(
      tx,
      userId,
      holding.id,
      { dropAction: old.id, addAction: replacement },
      replace ? "That change would leave an impossible position" : "Removing this would leave an impossible position",
    );
    await tx.update(corporateActions).set({ voidedAt: new Date() }).where(eq(corporateActions.id, old.id));
    if (replacement) await tx.insert(corporateActions).values({ userId, ...replacement, note: common!.note });
  });
}

export async function editCorporateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctAction(formData, true);
}

export async function removeCorporateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctAction(formData, false);
}

/** Appends a price. A wrong one is corrected with editPriceUpdate or removePriceUpdate, which void it. */
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

/** Edit (replace = true) or remove (false) a price update. A price feeds no validator, so there is no history to re-check. */
async function correctPrice(formData: FormData, replace: boolean): Promise<ActionState> {
  const userId = await requireUserId();
  const rowId = id(formData, "id");
  const price = replace ? decimal(formData, "price") : null;
  if (replace && price === null) return { error: PRICE_ERROR };
  const date = replace ? str(formData, "date") || cairoToday() : "";
  if (replace && !isRealDate(date)) return { error: DATE_ERROR };
  if (replace && date > cairoToday()) return { error: "A price cannot be dated in the future." };
  const [parent] = rowId
    ? await db
        .select({ holdingId: priceUpdates.holdingId })
        .from(priceUpdates)
        .where(and(eq(priceUpdates.id, rowId), eq(priceUpdates.userId, userId)))
    : [];
  if (!rowId || !parent) return { error: RECORD_NOT_FOUND };

  return mutate(userId, parent.holdingId, async (tx, holding) => {
    const [old] = await tx
      .select()
      .from(priceUpdates)
      .where(
        and(
          eq(priceUpdates.id, rowId),
          eq(priceUpdates.userId, userId),
          eq(priceUpdates.holdingId, holding.id),
          isNull(priceUpdates.voidedAt),
        ),
      )
      .for("update");
    if (!old) return refuse(RECORD_NOT_FOUND);
    await tx.update(priceUpdates).set({ voidedAt: new Date() }).where(eq(priceUpdates.id, old.id));
    if (price !== null) {
      await tx
        .insert(priceUpdates)
        .values({ userId, holdingId: holding.id, date, price, createdAt: replacementStamp(old, date) });
    }
  });
}

export async function editPriceUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctPrice(formData, true);
}

export async function removePriceUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return correctPrice(formData, false);
}

/**
 * Voids a buy, sell, dividend, or a cloud deposit or withdrawal. Refused if the position would go impossible on any
 * date, or (a cloud) if a withdrawal would end up larger than the estimated value.
 */
export async function voidInvestmentTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const txId = id(formData, "id");
  if (!txId) return { error: TX_NOT_FOUND };

  const [row] = await db
    .select({ holdingId: transactions.holdingId })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, userId)));
  if (!row?.holdingId) return { error: TX_NOT_FOUND };

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
      await assertHistory(tx, userId, holding.id, {}, "Voiding this would leave an impossible position");
    }
  }, true);
}
