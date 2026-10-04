import "server-only";
import {
  type CloudValue,
  loadWealth,
  type PortfolioData,
  type PortfolioHoldingRow,
  type RateHistoryEntry,
  type RemovedRecords,
  type TransactionRow,
  type WealthData,
} from "@/db/queries";
import { cloudProjection } from "@/lib/finance-core/clouds";
import { unrealizedPL } from "@/lib/finance-core/holdings";
import { netWorth } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import {
  type HoldingState,
  type HoldingValue,
  lastTransactionPrice,
  type PriceUpdate,
  priceAsOf,
  replayHolding,
} from "@/lib/finance-core/portfolio";

/** A unit-based holding, or physical gold (grams are the units, the price is the karat's buy-back price per gram). */
export type HoldingView = {
  row: PortfolioHoldingRow;
  /** Replayed as of today: quantity, cost basis, average cost, realized profit or loss, dividends, total invested. */
  state: HoldingState;
  /** The price the value uses (latest price update, else last transaction price); null when there is neither. */
  price: string | null;
  value: Piasters;
  source: HoldingValue["source"];
  priceDate: string | null;
  days: number | null;
  /** Only ever true for a holding still held. */
  stale: boolean;
  /** Profit or loss on what is still held. */
  unrealized: Piasters;
};

export type CloudView = {
  row: PortfolioHoldingRow;
  est: CloudValue;
  /** The APY in force today and the date it took effect; null until one is entered. */
  rate: RateHistoryEntry | null;
  /** Expected values from the current APY (a missing APY counts as 0%) and the planned contribution. Assumed, not guaranteed. */
  projection: {
    monthlyContribution: Piasters;
    in12Months: Piasters;
    atMaturity: { months: number; projected: Piasters } | null;
  } | null;
};

export type Investments = {
  today: string;
  staleDays: number;
  wealth: WealthData;
  portfolio: PortfolioData;
  /** Stocks, funds, other and gold; archived included (they hold nothing, but their realized profit or loss still counts). */
  views: HoldingView[];
  /** Savings Clouds, archived included. */
  clouds: CloudView[];
  totals: { stocks: Piasters; gold: Piasters; clouds: Piasters; all: Piasters };
  stale: boolean;
  /** Which kinds have a stale value, for the notice ("stocks and funds", "gold", "Savings Clouds"). */
  staleKinds: string[];
  /** Profit or loss on what is still held: stocks, funds and gold. */
  unrealized: Piasters;
  realized: Piasters;
  /** Accrued Savings Cloud growth (estimated). Market change, not income. */
  cloudGrowth: Piasters;
};

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Whole calendar months from `from` to `to` (YYYY-MM-DD), never negative. */
function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** Every figure the investment screens show, replayed by finance-core as of `today`. */
export async function loadInvestments(userId: string, today: string): Promise<Investments> {
  const wealth = await loadWealth(userId, today);
  const { portfolio, valuation } = wealth;
  const line = new Map(valuation.lines.map((l) => [l.id, l]));
  const cloudById = new Map(valuation.clouds.map((c) => [c.id, c]));

  const views: HoldingView[] = [];
  const clouds: CloudView[] = [];
  for (const row of portfolio.holdings) {
    if (row.kind === "cloud") {
      const est = cloudById.get(row.id)!;
      const contribution =
        row.contributionAmount !== null && row.contributionFrequency !== null
          ? { amount: row.contributionAmount, frequency: row.contributionFrequency }
          : null;
      const project = (months: number) => cloudProjection({ value: est.value, apy: est.apy, contribution, months });
      const twelve = project(12);
      const maturityMonths = row.maturityDate && row.maturityDate > today ? monthsBetween(today, row.maturityDate) : 0;
      clouds.push({
        row,
        est,
        rate: portfolio.rateHistory.find((r) => r.holdingId === row.id && r.date <= today) ?? null,
        projection: row.archivedAt
          ? null
          : {
              monthlyContribution: twelve.monthlyContribution,
              in12Months: twelve.projected,
              atMaturity: maturityMonths > 0 ? { months: maturityMonths, projected: project(maturityMonths).projected } : null,
            },
      });
      continue;
    }
    const l = line.get(row.id)!;
    const state = replayHolding(row.events, today);
    // Same precedence as the engine's holdingValue: a price update first, else the last transaction price.
    const price = priceAsOf(row.priceUpdates, today)?.price ?? lastTransactionPrice(row.events, today);
    views.push({
      row,
      state,
      price,
      value: l.value,
      source: l.source,
      priceDate: l.priceDate,
      days: l.days,
      stale: l.stale,
      unrealized: price === null ? 0 : unrealizedPL(state, price),
    });
  }

  const stocks = views.filter((v) => v.row.kind !== "gold");
  const gold = views.filter((v) => v.row.kind === "gold");
  const staleKinds = [
    stocks.some((v) => v.stale) && "stocks and funds",
    gold.some((v) => v.stale) && "gold",
    clouds.some((c) => c.est.stale) && "Savings Clouds",
  ].filter((k): k is string => k !== false);

  return {
    today,
    staleDays: portfolio.staleDays,
    wealth,
    portfolio,
    views,
    clouds,
    totals: {
      stocks: sum(stocks.map((v) => v.value)),
      gold: sum(gold.map((v) => v.value)),
      clouds: sum(clouds.map((c) => c.est.value)),
      all: valuation.total,
    },
    stale: valuation.stale,
    staleKinds,
    unrealized: sum(views.map((v) => v.unrealized)),
    realized: sum(views.map((v) => v.state.realizedPL)),
    cloudGrowth: sum(clouds.map((c) => c.est.growth)),
  };
}

/** Value of everything held per brokerage account: stocks, funds, gold and clouds. */
export function holdingsByAccount(inv: Investments): Map<string, Piasters> {
  const byAccount = new Map<string, Piasters>();
  for (const h of inv.portfolio.holdings) {
    byAccount.set(h.accountId, (byAccount.get(h.accountId) ?? 0) + (inv.wealth.holdingValues.get(h.id) ?? 0));
  }
  return byAccount;
}

/** A brokerage account is worth its cash plus what it holds. */
export const accountValue = (cash: Piasters, holdings: Piasters): Piasters => netWorth({ cash, holdings, liabilities: 0 });

type Base = { key: string; date: string; createdAt: string; note: string | null; removed: boolean };
/** The cash account of a ledger row, so its correction form can keep it. */
type Cash = { txId: string; accountId: string | null };
export type HistoryEntry = Base &
  (
    | ({ kind: "buy"; quantity: string; price: string; amount: Piasters; fee: Piasters } & Cash)
    | ({ kind: "sell"; quantity: string; price: string; amount: Piasters; fee: Piasters; tax: Piasters } & Cash)
    | ({ kind: "dividend"; amount: Piasters; gross: Piasters; tax: Piasters } & Cash)
    | ({ kind: "deposit"; amount: Piasters } & Cash)
    | ({ kind: "withdrawal"; amount: Piasters } & Cash)
    | { kind: "rate"; apy: number }
    | { kind: "confirmed"; value: Piasters }
    | { kind: "bonus"; quantity: string }
    | { kind: "split"; ratio: string }
    | { kind: "writeOff" }
    /** `id` is null for a gold price: those are shared, listed and corrected on the Investments page. */
    | { kind: "price"; id: string | null; price: string }
  );

/** What was removed from one holding's history: voided ledger rows and the voided records of the six correctable tables. */
export type RemovedHistory = { trades: TransactionRow[]; records: RemovedRecords };

/** Every voided holding ledger row of the user, plus the removed records; holdingHistory picks the holding's own. */
export const removedHistory = (allTransactions: TransactionRow[], records: RemovedRecords): RemovedHistory => ({
  trades: allTransactions.filter((t) => t.holdingId !== null && t.status === "void"),
  records,
});

function tradeEntry(t: TransactionRow, removed: boolean): HistoryEntry | null {
  const base = { key: t.id, txId: t.id, accountId: t.fromAccountId ?? t.toAccountId, date: t.date, createdAt: t.createdAt.toISOString(), note: t.note, removed };
  if (t.type === "INVESTMENT_PURCHASE") {
    return t.quantity === null
      ? { ...base, kind: "deposit", amount: t.amount }
      : { ...base, kind: "buy", quantity: t.quantity, price: t.unitPrice!, amount: t.amount, fee: t.fee };
  }
  if (t.type === "INVESTMENT_SALE") {
    return t.quantity === null
      ? { ...base, kind: "withdrawal", amount: t.amount }
      : { ...base, kind: "sell", quantity: t.quantity, price: t.unitPrice!, amount: t.amount, fee: t.fee, tax: t.taxWithheld ?? 0 };
  }
  if (t.type === "DIVIDEND") return { ...base, kind: "dividend", amount: t.amount, gross: t.grossAmount ?? t.amount, tax: t.taxWithheld ?? 0 };
  return null;
}

function actionEntry(a: PortfolioData["corporateActions"][number], removed: boolean): HistoryEntry {
  const base = { key: a.id, date: a.date, createdAt: a.createdAt.toISOString(), note: a.note, removed };
  if (a.kind === "BONUS") return { ...base, kind: "bonus", quantity: a.quantity! };
  if (a.kind === "SPLIT") return { ...base, kind: "split", ratio: a.ratio! };
  return { ...base, kind: "writeOff" };
}

/**
 * One holding's posted trades, corporate actions, price updates, rate changes and confirmations, newest first. Removed
 * entries come in flagged `removed` when `removed` is given: the list hides them behind "Show removed" and nothing counts them.
 * `prices` carry an id for a stock or fund; a gold row's prices are the shared ones and cannot be corrected here.
 */
export function holdingHistory(
  portfolio: PortfolioData,
  holdingId: string,
  prices: { id?: string; date: string; price: string; createdAt: string }[],
  removed?: RemovedHistory,
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const mine = (id: string) => id === holdingId;
  for (const [rows, gone] of [[portfolio.trades, false], [removed?.trades ?? [], true]] as const) {
    for (const t of rows) {
      const e = mine(t.holdingId ?? "") ? tradeEntry(t, gone) : null;
      if (e) out.push(e);
    }
  }
  for (const [rows, gone] of [[portfolio.corporateActions, false], [removed?.records.corporateActions ?? [], true]] as const) {
    for (const a of rows) if (mine(a.holdingId)) out.push(actionEntry(a, gone));
  }
  for (const [rows, gone] of [[portfolio.rateHistory, false], [removed?.records.rateHistory ?? [], true]] as const) {
    for (const r of rows) {
      if (mine(r.holdingId)) out.push({ key: r.id, date: r.date, createdAt: r.createdAt, note: null, removed: gone, kind: "rate", apy: r.apy });
    }
  }
  for (const [rows, gone] of [[portfolio.confirmations, false], [removed?.records.confirmations ?? [], true]] as const) {
    for (const c of rows) {
      if (mine(c.holdingId)) out.push({ key: c.id, date: c.date, createdAt: c.createdAt, note: null, removed: gone, kind: "confirmed", value: c.value });
    }
  }
  const priceEntry = (p: { id?: string; date: string; price: string; createdAt: string }, gone: boolean): HistoryEntry => ({
    key: p.id ?? `price-${p.date}-${p.createdAt}`,
    date: p.date,
    createdAt: p.createdAt,
    note: null,
    removed: gone,
    kind: "price",
    id: p.id ?? null,
    price: p.price,
  });
  for (const p of prices) out.push(priceEntry(p, false));
  for (const p of removed?.records.priceUpdates ?? []) if (mine(p.holdingId)) out.push(priceEntry(p, true));
  return out.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
  );
}
