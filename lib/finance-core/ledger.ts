import type { Piasters } from "./money";

export type TxType =
  | "INCOME"
  | "EXPENSE"
  | "TRANSFER"
  | "INVESTMENT_PURCHASE"
  | "INVESTMENT_SALE"
  | "LIABILITY_PAYMENT"
  | "DIVIDEND"
  | "INTEREST"
  | "ADJUSTMENT";

export type Tx = {
  type: TxType;
  date: string; // YYYY-MM-DD
  amount: Piasters; // > 0, except ADJUSTMENT which is signed
  fromAccountId?: string;
  toAccountId?: string;
  status: "pending" | "posted" | "void";
};

export type PeriodSummary = {
  earnedIncome: Piasters;
  investmentIncome: Piasters;
  totalIncome: Piasters;
  spending: Piasters;
  savings: Piasters;
  savingsRate: number | null;
  invested: Piasters;
  saleProceeds: Piasters;
  netInvested: Piasters;
  adjustments: Piasters;
  liabilityPrincipalPaid: Piasters;
};

const posted = (txs: Tx[]) => txs.filter((t) => t.status === "posted");

function checkAmount(tx: Tx): void {
  const ok = Number.isSafeInteger(tx.amount) && (tx.type === "ADJUSTMENT" ? tx.amount !== 0 : tx.amount > 0);
  if (!ok) throw new RangeError(`Invalid ${tx.type} amount: ${tx.amount}`);
}

/** Signed effect of one posted transaction on one account. */
function effectOn(tx: Tx, accountId: string): Piasters {
  checkAmount(tx);
  const to = tx.toAccountId === accountId ? tx.amount : 0;
  const from = tx.fromAccountId === accountId ? tx.amount : 0;
  switch (tx.type) {
    case "INCOME":
    case "INVESTMENT_SALE":
    case "DIVIDEND":
    case "INTEREST":
    case "ADJUSTMENT":
      return to;
    case "EXPENSE":
    case "INVESTMENT_PURCHASE":
    case "LIABILITY_PAYMENT":
      return -from;
    case "TRANSFER":
      return to - from;
  }
}

export function accountBalance(openingBalance: Piasters, accountId: string, txs: Tx[]): Piasters {
  return posted(txs).reduce((sum, t) => sum + effectOn(t, accountId), openingBalance);
}

/** Inclusive on both ends; YYYY-MM-DD strings compare correctly as text. */
export function filterByDateRange(txs: Tx[], from: string, to: string): Tx[] {
  return txs.filter((t) => t.date >= from && t.date <= to);
}

export function periodSummary(txs: Tx[]): PeriodSummary {
  const sum = (...types: TxType[]) =>
    posted(txs).reduce((s, t) => (types.includes(t.type) ? (checkAmount(t), s + t.amount) : s), 0);

  const earnedIncome = sum("INCOME");
  const investmentIncome = sum("DIVIDEND", "INTEREST");
  const totalIncome = earnedIncome + investmentIncome;
  const spending = sum("EXPENSE");
  const savings = totalIncome - spending;
  const invested = sum("INVESTMENT_PURCHASE");
  const saleProceeds = sum("INVESTMENT_SALE");
  return {
    earnedIncome,
    investmentIncome,
    totalIncome,
    spending,
    savings,
    savingsRate: totalIncome === 0 ? null : savings / totalIncome,
    invested,
    saleProceeds,
    netInvested: invested - saleProceeds,
    adjustments: sum("ADJUSTMENT"),
    liabilityPrincipalPaid: sum("LIABILITY_PAYMENT"),
  };
}

/** Value change not explained by money put in or taken out of investments. */
export function marketChange(startHoldingsValue: Piasters, endHoldingsValue: Piasters, netInvested: Piasters): Piasters {
  return endHoldingsValue - startHoldingsValue - netInvested;
}

export function netWorth(parts: { cash: Piasters; holdings: Piasters; liabilities: Piasters }): Piasters {
  return parts.cash + parts.holdings - parts.liabilities;
}

export function reconcile(
  netWorthChange: Piasters,
  savings: Piasters,
  marketChange: Piasters,
  adjustments: Piasters,
): { ok: boolean; difference: Piasters } {
  const difference = netWorthChange - (savings + marketChange + adjustments);
  return { ok: difference === 0, difference };
}
