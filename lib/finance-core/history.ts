import { accountBalance, netWorth, type Tx } from "./ledger";
import { outstanding, type LiabilityUpdate, type PrincipalPayment } from "./liabilities";
import type { Piasters } from "./money";
import { addDays, dateOn, daysBetween } from "./recurring";

/**
 * Net worth history is replayed, never stored (H1): every date is evaluated from the records dated on or before it, so
 * a back-dated price or transaction changes the past by itself, and a value between two updates is carried forward
 * (a step function), never interpolated.
 */
export const HISTORY_RANGES = ["7d", "1m", "3m", "6m", "1y", "all"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** Upper bound on as-of evaluations per request. */
export const MAX_POINTS = 100;

const MONTHS_BACK: Record<Exclude<HistoryRange, "7d" | "all">, number> = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };

function monthsBefore(date: string, months: number): string {
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 - months;
  return dateOn(Math.floor(total / 12), (total % 12) + 1, Number(date.slice(8, 10)));
}

/**
 * The dates to evaluate for a range ending `today`. Daily when the span is up to 3 months, weekly up to a year, monthly
 * beyond; the first and last date are always there, and at most MAX_POINTS dates come back (a very long history is
 * thinned evenly). The first date is the later of the range start and `firstDate` (nothing happened before it);
 * "all" starts at `firstDate`. No data yet -> just today.
 */
export function samplingDates(range: HistoryRange, firstDate: string | null, today: string): string[] {
  const wanted = range === "all" ? today : range === "7d" ? addDays(today, -7) : monthsBefore(today, MONTHS_BACK[range]);
  const start = range === "all" ? (firstDate ?? today) : firstDate !== null && firstDate > wanted ? firstDate : wanted;
  if (start >= today) return [today];

  const span = daysBetween(start, today);
  const dates: string[] = [];
  if (span <= 93) {
    for (let d = start; d <= today; d = addDays(d, 1)) dates.push(d);
  } else if (span <= 366) {
    for (let d = start; d < today; d = addDays(d, 7)) dates.push(d);
    dates.push(today);
  } else {
    for (let k = 0; ; k++) {
      const d = monthsBefore(start, -k);
      if (d >= today) break;
      dates.push(d);
    }
    dates.push(today);
  }
  if (dates.length <= MAX_POINTS) return dates;
  const last = dates.length - 1;
  return Array.from({ length: MAX_POINTS }, (_, i) => dates[Math.round((i * last) / (MAX_POINTS - 1))]);
}

/** One date as the loader hands it over. Credit cards are listed per card so a negative one can count as debt. */
export type SnapshotInput = {
  date: string;
  /** Sum of every account that is not a credit card (may be negative). */
  cash: Piasters;
  /** Balance of each credit card: negative = money owed on it. */
  cardBalances: Piasters[];
  /** Everything held: stocks, funds, gold and savings clouds. */
  investments: Piasters;
  /** Outstanding on loans and other liabilities. */
  liabilities: Piasters;
  /** Some of the investment values behind this date were stale. */
  stale?: boolean;
};

export type HistoryPoint = {
  date: string;
  netWorth: Piasters;
  cash: Piasters;
  investments: Piasters;
  /** Liabilities plus negative credit-card balances, as a positive figure. */
  debt: Piasters;
  stale: boolean;
};

/** netWorth = cash + investments - debt, exactly (a positive card balance counts as cash). */
export function seriesFromSnapshots(points: SnapshotInput[]): HistoryPoint[] {
  return points.map((p) => {
    const cash = p.cash + p.cardBalances.reduce((s, b) => s + Math.max(0, b), 0);
    const debt = p.liabilities + p.cardBalances.reduce((s, b) => s + Math.max(0, -b), 0);
    return {
      date: p.date,
      netWorth: netWorth({ cash, holdings: p.investments, liabilities: debt }),
      cash,
      investments: p.investments,
      debt,
      stale: p.stale ?? false,
    };
  });
}

/** What the loader reads once; every date is then evaluated from it in memory. */
export type HistoryData = {
  accounts: { id: string; opening: Piasters; creditCard: boolean }[];
  /** Ledger rows of any status: only posted ones count. */
  txs: Tx[];
  liabilities: { opening: Piasters; updates: LiabilityUpdate[]; payments: PrincipalPayment[] }[];
  /** Value of everything held as of a date (portfolioValue / the loader's valuePortfolio). */
  investmentsAt: (date: string) => { total: Piasters; stale: boolean };
};

/** The as-of evaluation, built on accountBalance, outstanding and the caller's portfolio valuation. */
export function snapshotsAsOf(data: HistoryData, dates: string[]): SnapshotInput[] {
  return dates.map((date) => {
    const upTo = data.txs.filter((t) => t.date <= date);
    const balance = (a: HistoryData["accounts"][number]) => accountBalance(a.opening, a.id, upTo);
    const held = data.investmentsAt(date);
    return {
      date,
      cash: data.accounts.filter((a) => !a.creditCard).reduce((s, a) => s + balance(a), 0),
      cardBalances: data.accounts.filter((a) => a.creditCard).map(balance),
      investments: held.total,
      liabilities: data.liabilities.reduce((s, l) => s + outstanding(l.opening, l.updates, l.payments, date), 0),
      stale: held.stale,
    };
  });
}
