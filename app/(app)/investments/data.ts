import "server-only";
import {
  type CloudValue,
  loadWealth,
  type PortfolioData,
  type PortfolioHoldingRow,
  type RateHistoryEntry,
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

type Base = { key: string; date: string; createdAt: string; note: string | null };
export type HistoryEntry = Base &
  (
    | { kind: "buy"; txId: string; quantity: string; price: string; amount: Piasters; fee: Piasters }
    | { kind: "sell"; txId: string; quantity: string; price: string; amount: Piasters; fee: Piasters; tax: Piasters }
    | { kind: "dividend"; txId: string; amount: Piasters; gross: Piasters; tax: Piasters }
    | { kind: "deposit"; txId: string; amount: Piasters }
    | { kind: "withdrawal"; txId: string; amount: Piasters }
    | { kind: "rate"; apy: number }
    | { kind: "confirmed"; value: Piasters }
    | { kind: "bonus"; quantity: string }
    | { kind: "split"; ratio: string }
    | { kind: "writeOff" }
    | { kind: "price"; price: string }
  );

/** One holding's posted trades, corporate actions, price updates, rate changes and confirmations, newest first. Voided rows are not in it. */
export function holdingHistory(portfolio: PortfolioData, holdingId: string, prices: PriceUpdate[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const t of portfolio.trades) {
    if (t.holdingId !== holdingId) continue;
    const base = { key: t.id, txId: t.id, date: t.date, createdAt: t.createdAt.toISOString(), note: t.note };
    if (t.type === "INVESTMENT_PURCHASE") {
      out.push(
        t.quantity === null
          ? { ...base, kind: "deposit", amount: t.amount }
          : { ...base, kind: "buy", quantity: t.quantity, price: t.unitPrice!, amount: t.amount, fee: t.fee },
      );
    } else if (t.type === "INVESTMENT_SALE") {
      out.push(
        t.quantity === null
          ? { ...base, kind: "withdrawal", amount: t.amount }
          : { ...base, kind: "sell", quantity: t.quantity, price: t.unitPrice!, amount: t.amount, fee: t.fee, tax: t.taxWithheld ?? 0 },
      );
    } else if (t.type === "DIVIDEND") {
      out.push({ ...base, kind: "dividend", amount: t.amount, gross: t.grossAmount ?? t.amount, tax: t.taxWithheld ?? 0 });
    }
  }
  for (const a of portfolio.corporateActions) {
    if (a.holdingId !== holdingId) continue;
    const base = { key: a.id, date: a.date, createdAt: a.createdAt.toISOString(), note: a.note };
    if (a.kind === "BONUS") out.push({ ...base, kind: "bonus", quantity: a.quantity! });
    else if (a.kind === "SPLIT") out.push({ ...base, kind: "split", ratio: a.ratio! });
    else out.push({ ...base, kind: "writeOff" });
  }
  for (const r of portfolio.rateHistory) {
    if (r.holdingId === holdingId) out.push({ key: r.id, date: r.date, createdAt: r.createdAt, note: null, kind: "rate", apy: r.apy });
  }
  for (const c of portfolio.confirmations) {
    if (c.holdingId === holdingId) out.push({ key: c.id, date: c.date, createdAt: c.createdAt, note: null, kind: "confirmed", value: c.value });
  }
  for (const p of prices) {
    out.push({ key: `price-${p.date}-${p.createdAt}`, date: p.date, createdAt: p.createdAt, note: null, kind: "price", price: p.price });
  }
  return out.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
  );
}
