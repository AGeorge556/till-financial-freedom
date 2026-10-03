import { actualContribution } from "./goals";
import { filterByDateRange, marketChange, periodSummary, reconcile, type Tx } from "./ledger";
import { liabilityAdjustments } from "./liabilities";
import type { Piasters } from "./money";

export type MonthlyReview = {
  earnedIncome: Piasters;
  investmentIncome: Piasters;
  totalIncome: Piasters;
  spending: Piasters;
  saved: Piasters;
  /** Share of income saved; null when there was no income. */
  savingsRate: number | null;
  /** Net invested: purchases minus sale proceeds. */
  invested: Piasters;
  keptAsCash: Piasters;
  marketChange: Piasters;
  netWorthChange: Piasters;
  /** Ledger ADJUSTMENT rows plus liability manual updates. */
  adjustments: Piasters;
  goalAllocations: Piasters;
  /** What the month's savings left unearmarked. Negative if more was earmarked than was saved. */
  unallocated: Piasters;
  reconciles: boolean;
  /** Net worth change minus (saved + market change + adjustments); 0 when it reconciles. Shown as it is, never hidden. */
  difference: Piasters;
};

/**
 * One financial month. Net worth and holdings values are computed by the caller as of the day before the month and
 * its last day (cash + holdings - liabilities). Rows outside `range` are ignored.
 * Allocations are earmarks of money already counted, not extra money.
 */
export function monthlyReview(input: {
  range: { start: string; end: string };
  txs: Tx[];
  netWorthStart: Piasters;
  netWorthEnd: Piasters;
  holdingsValueStart: Piasters;
  holdingsValueEnd: Piasters;
  liabilityUpdates: { date: string; delta: Piasters }[];
  allocationEvents: { date: string; delta: Piasters }[];
}): MonthlyReview {
  const { range } = input;
  const s = periodSummary(filterByDateRange(input.txs, range.start, range.end));
  const market = marketChange(input.holdingsValueStart, input.holdingsValueEnd, s.netInvested);
  const adjustments = s.adjustments + liabilityAdjustments(input.liabilityUpdates, range);
  const netWorthChange = input.netWorthEnd - input.netWorthStart;
  const goalAllocations = actualContribution(input.allocationEvents, range);
  const { ok, difference } = reconcile(netWorthChange, s.savings, market, adjustments);
  return {
    earnedIncome: s.earnedIncome,
    investmentIncome: s.investmentIncome,
    totalIncome: s.totalIncome,
    spending: s.spending,
    saved: s.savings,
    savingsRate: s.savingsRate,
    invested: s.netInvested,
    keptAsCash: s.savings - s.netInvested,
    marketChange: market,
    netWorthChange,
    adjustments,
    goalAllocations,
    unallocated: s.savings - goalAllocations,
    reconciles: ok,
    difference,
  };
}
