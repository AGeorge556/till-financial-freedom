import "server-only";
import { loadPortfolio, type PortfolioData, type PortfolioHoldingRow } from "@/db/queries";
import { unrealizedPL } from "@/lib/finance-core/holdings";
import { netWorth } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import {
  type HoldingState,
  type HoldingValue,
  lastTransactionPrice,
  type PriceUpdate,
  portfolioValue,
  priceAsOf,
  replayHolding,
} from "@/lib/finance-core/portfolio";

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

export type Investments = {
  staleDays: number;
  /** Archived holdings included (they hold nothing, but their realized profit or loss still counts). */
  views: HoldingView[];
  total: Piasters;
  stale: boolean;
  unrealized: Piasters;
  realized: Piasters;
  portfolio: PortfolioData;
};

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Every figure the investment screens show, replayed by finance-core as of `today`. */
export async function loadInvestments(userId: string, today: string): Promise<Investments> {
  const portfolio = await loadPortfolio(userId);
  const valued = portfolioValue(portfolio.holdings, today, portfolio.staleDays);
  const views = portfolio.holdings.map((row, i): HoldingView => {
    const line = valued.lines[i];
    const state = replayHolding(row.events, today);
    // Same precedence as the engine's holdingValue: a price update first, else the last transaction price.
    const price = priceAsOf(row.priceUpdates, today)?.price ?? lastTransactionPrice(row.events, today);
    return {
      row,
      state,
      price,
      value: line.value,
      source: line.source,
      priceDate: line.priceDate,
      days: line.days,
      stale: line.stale,
      unrealized: price === null ? 0 : unrealizedPL(state, price),
    };
  });
  return {
    staleDays: portfolio.staleDays,
    views,
    total: valued.total,
    stale: valued.stale,
    unrealized: sum(views.map((v) => v.unrealized)),
    realized: sum(views.map((v) => v.state.realizedPL)),
    portfolio,
  };
}

/** Holdings value per brokerage account. */
export function holdingsByAccount(views: HoldingView[]): Map<string, Piasters> {
  const byAccount = new Map<string, Piasters>();
  for (const v of views) byAccount.set(v.row.accountId, (byAccount.get(v.row.accountId) ?? 0) + v.value);
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
    | { kind: "bonus"; quantity: string }
    | { kind: "split"; ratio: string }
    | { kind: "writeOff" }
    | { kind: "price"; price: string }
  );

/** One holding's posted trades, corporate actions and price updates, newest first. Voided rows are not in it. */
export function holdingHistory(portfolio: PortfolioData, holdingId: string, prices: PriceUpdate[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const t of portfolio.trades) {
    if (t.holdingId !== holdingId) continue;
    const base = { key: t.id, txId: t.id, date: t.date, createdAt: t.createdAt.toISOString(), note: t.note };
    if (t.type === "INVESTMENT_PURCHASE") {
      out.push({ ...base, kind: "buy", quantity: t.quantity!, price: t.unitPrice!, amount: t.amount, fee: t.fee });
    } else if (t.type === "INVESTMENT_SALE") {
      out.push({ ...base, kind: "sell", quantity: t.quantity!, price: t.unitPrice!, amount: t.amount, fee: t.fee, tax: t.taxWithheld ?? 0 });
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
  for (const p of prices) {
    out.push({ key: `price-${p.date}-${p.createdAt}`, date: p.date, createdAt: p.createdAt, note: null, kind: "price", price: p.price });
  }
  return out.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
  );
}
