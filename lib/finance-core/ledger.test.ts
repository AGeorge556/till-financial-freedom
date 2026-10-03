import { describe, expect, it } from "vitest";
import { egpToPiasters as egp } from "./money";
import { applyPurchase, applySale, marketValue, type Position } from "./holdings";
import {
  accountBalance,
  filterByDateRange,
  marketChange,
  netWorth,
  periodSummary,
  reconcile,
  type Tx,
} from "./ledger";

const tx = (t: Partial<Tx> & Pick<Tx, "type" | "amount">): Tx => ({ date: "2026-03-10", status: "posted", ...t });

describe("fixture 6: transfer bank -> Thndr", () => {
  const txs = [tx({ type: "TRANSFER", amount: egp(10_000), fromAccountId: "bank", toAccountId: "thndr" })];

  it("moves balances by -10,000 / +10,000", () => {
    expect(accountBalance(egp(50_000), "bank", txs)).toBe(egp(40_000));
    expect(accountBalance(0, "thndr", txs)).toBe(egp(10_000));
  });

  it("changes no income, spending, savings or net worth", () => {
    const s = periodSummary(txs);
    expect([s.totalIncome, s.spending, s.savings, s.netInvested]).toEqual([0, 0, 0, 0]);
    expect(s.savingsRate).toBeNull();
    const before = netWorth({ cash: egp(50_000), holdings: 0, liabilities: 0 });
    const after = netWorth({
      cash: accountBalance(egp(50_000), "bank", txs) + accountBalance(0, "thndr", txs),
      holdings: 0,
      liabilities: 0,
    });
    expect(after).toBe(before);
  });
});

describe("account effects by type", () => {
  it("applies each type's sign to the right account", () => {
    const txs = [
      tx({ type: "INCOME", amount: 100, toAccountId: "a" }),
      tx({ type: "EXPENSE", amount: 30, fromAccountId: "a" }),
      tx({ type: "INVESTMENT_PURCHASE", amount: 20, fromAccountId: "a" }),
      tx({ type: "INVESTMENT_SALE", amount: 15, toAccountId: "a" }),
      tx({ type: "DIVIDEND", amount: 5, toAccountId: "a" }),
      tx({ type: "INTEREST", amount: 2, toAccountId: "a" }),
      tx({ type: "LIABILITY_PAYMENT", amount: 10, fromAccountId: "a" }),
      tx({ type: "ADJUSTMENT", amount: -7, toAccountId: "a" }),
    ];
    expect(accountBalance(1_000, "a", txs)).toBe(1_000 + 100 - 30 - 20 + 15 + 5 + 2 - 10 - 7);
    expect(accountBalance(1_000, "other", txs)).toBe(1_000);
  });

  it("rejects non-positive amounts except a non-zero signed adjustment", () => {
    expect(() => accountBalance(0, "a", [tx({ type: "EXPENSE", amount: -5, fromAccountId: "a" })])).toThrow(RangeError);
    expect(() => accountBalance(0, "a", [tx({ type: "ADJUSTMENT", amount: 0, toAccountId: "a" })])).toThrow(RangeError);
    expect(() => accountBalance(0, "a", [tx({ type: "INCOME", amount: 1.5, toAccountId: "a" })])).toThrow(RangeError);
  });
});

describe("periodSummary", () => {
  it("splits earned vs investment income and excludes non-spending outflows", () => {
    const s = periodSummary([
      tx({ type: "INCOME", amount: 1_000, toAccountId: "a" }),
      tx({ type: "DIVIDEND", amount: 100, toAccountId: "a" }),
      tx({ type: "INTEREST", amount: 50, toAccountId: "a" }),
      tx({ type: "EXPENSE", amount: 400, fromAccountId: "a" }),
      tx({ type: "LIABILITY_PAYMENT", amount: 300, fromAccountId: "a" }),
      tx({ type: "INVESTMENT_PURCHASE", amount: 200, fromAccountId: "a" }),
      tx({ type: "INVESTMENT_SALE", amount: 80, toAccountId: "a" }),
      tx({ type: "ADJUSTMENT", amount: -25, toAccountId: "a" }),
    ]);
    expect(s).toEqual({
      earnedIncome: 1_000,
      investmentIncome: 150,
      totalIncome: 1_150,
      spending: 400,
      savings: 750,
      savingsRate: 750 / 1_150,
      invested: 200,
      saleProceeds: 80,
      netInvested: 120,
      adjustments: -25,
      liabilityPrincipalPaid: 300,
    });
  });

  it("allows negative savings and reports null rate when income is 0", () => {
    const s = periodSummary([tx({ type: "EXPENSE", amount: 500, fromAccountId: "a" })]);
    expect(s.savings).toBe(-500);
    expect(s.savingsRate).toBeNull();
    const t = periodSummary([
      tx({ type: "INCOME", amount: 100, toAccountId: "a" }),
      tx({ type: "EXPENSE", amount: 150, fromAccountId: "a" }),
    ]);
    expect(t.savingsRate).toBe(-0.5);
  });

  it("ignores pending and void rows everywhere", () => {
    const rows: Tx[] = [
      tx({ type: "INCOME", amount: 999, toAccountId: "a", status: "pending" }),
      tx({ type: "EXPENSE", amount: 999, fromAccountId: "a", status: "void" }),
      tx({ type: "ADJUSTMENT", amount: 999, toAccountId: "a", status: "pending" }),
    ];
    expect(accountBalance(100, "a", rows)).toBe(100);
    expect(periodSummary(rows).totalIncome).toBe(0);
    expect(periodSummary(rows).spending).toBe(0);
    expect(periodSummary(rows).adjustments).toBe(0);
  });
});

describe("filterByDateRange", () => {
  it("is inclusive on both ends", () => {
    const rows = ["2026-02-28", "2026-03-01", "2026-03-31", "2026-04-01"].map((date) =>
      tx({ type: "INCOME", amount: 1, toAccountId: "a", date }),
    );
    expect(filterByDateRange(rows, "2026-03-01", "2026-03-31").map((t) => t.date)).toEqual([
      "2026-03-01",
      "2026-03-31",
    ]);
  });
});

describe("marketChange / netWorth / reconcile", () => {
  it("computes the pieces", () => {
    expect(marketChange(1_000, 1_500, 200)).toBe(300);
    expect(netWorth({ cash: 500, holdings: 1_000, liabilities: 300 })).toBe(1_200);
  });

  it("flags any piaster of difference", () => {
    expect(reconcile(100, 60, 30, 10)).toEqual({ ok: true, difference: 0 });
    expect(reconcile(101, 60, 30, 10)).toEqual({ ok: false, difference: 1 });
  });
});

describe("fixture 7: reconciliation identity end to end", () => {
  // Start: 50,000 cash; 100 shares bought earlier at 100 (basis 10,000), price 100.
  const startPosition = applyPurchase({ quantity: "0", costBasis: 0 }, "100", "100", 0);
  const startPrice = "100";
  const endPrice = "125";
  const opening = egp(50_000);

  const march: Tx[] = [
    tx({ type: "INCOME", amount: egp(20_000), toAccountId: "bank", date: "2026-03-01" }),
    tx({ type: "EXPENSE", amount: egp(8_000), fromAccountId: "bank", date: "2026-03-05" }),
    // buy 50 @ 120 + 30 fee
    tx({ type: "INVESTMENT_PURCHASE", amount: egp(6_030), fromAccountId: "bank", date: "2026-03-10" }),
    // sell 30 @ 130 - 20 fee
    tx({ type: "INVESTMENT_SALE", amount: egp(3_880), toAccountId: "bank", date: "2026-03-15" }),
    tx({ type: "DIVIDEND", amount: egp(450), toAccountId: "bank", date: "2026-03-20" }),
  ];
  const noise: Tx[] = [
    tx({ type: "INCOME", amount: egp(99_999), toAccountId: "bank", status: "pending" }),
    tx({ type: "EXPENSE", amount: egp(88_888), fromAccountId: "bank", status: "void" }),
  ];

  function run(txs: Tx[]) {
    const bought = applyPurchase(startPosition, "50", "120", egp(30));
    const sale = applySale(bought, "30", "130", egp(20));
    const endPosition: Position = sale.remaining;

    const startHoldings = marketValue(startPosition, startPrice);
    const endHoldings = marketValue(endPosition, endPrice);
    const summary = periodSummary(filterByDateRange(txs, "2026-03-01", "2026-03-31"));

    const startNW = netWorth({ cash: opening, holdings: startHoldings, liabilities: 0 });
    const endNW = netWorth({
      cash: accountBalance(opening, "bank", txs),
      holdings: endHoldings,
      liabilities: 0,
    });
    const market = marketChange(startHoldings, endHoldings, summary.netInvested);
    return { sale, endPosition, summary, startNW, endNW, market, endHoldings };
  }

  it("holds exactly with real balances and positions", () => {
    const r = run(march);
    expect(r.endPosition.quantity).toBe("120");
    expect(r.endHoldings).toBe(egp(15_000));
    expect(r.startNW).toBe(egp(60_000));
    expect(r.endNW).toBe(egp(75_300));
    expect(r.summary.savings).toBe(egp(12_450));
    expect(r.summary.netInvested).toBe(egp(2_150));
    expect(r.market).toBe(egp(2_850));
    expect(reconcile(r.endNW - r.startNW, r.summary.savings, r.market, r.summary.adjustments)).toEqual({
      ok: true,
      difference: 0,
    });
  });

  it("is unchanged by pending and void rows", () => {
    const clean = run(march);
    const noisy = run([...march, ...noise]);
    expect(noisy.endNW).toBe(clean.endNW);
    expect(noisy.summary).toEqual(clean.summary);
  });

  it("detects a mismatch if a signed adjustment is ignored", () => {
    const withAdj = [...march, tx({ type: "ADJUSTMENT", amount: egp(500), toAccountId: "bank", date: "2026-03-25" })];
    const r = run(withAdj);
    const change = r.endNW - r.startNW;
    expect(reconcile(change, r.summary.savings, r.market, r.summary.adjustments).ok).toBe(true);
    expect(reconcile(change, r.summary.savings, r.market, 0)).toEqual({ ok: false, difference: egp(500) });
  });
});
