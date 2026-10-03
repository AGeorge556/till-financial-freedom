import { describe, expect, it } from "vitest";
import { accountBalance, netWorth, type Tx } from "./ledger";
import { outstanding } from "./liabilities";
import { egpToPiasters as egp } from "./money";
import { monthlyReview } from "./review";

const RANGE = { start: "2026-03-01", end: "2026-03-31" };
const tx = (t: Partial<Tx> & Pick<Tx, "type" | "amount">): Tx => ({ date: "2026-03-10", status: "posted", ...t });

describe("spec example (V4)", () => {
  const review = monthlyReview({
    range: RANGE,
    txs: [
      tx({ type: "INCOME", amount: egp(30_000), toAccountId: "bank" }),
      tx({ type: "EXPENSE", amount: egp(12_000), fromAccountId: "bank" }),
      tx({ type: "INVESTMENT_PURCHASE", amount: egp(10_000), fromAccountId: "bank" }),
    ],
    netWorthStart: egp(100_000),
    netWorthEnd: egp(121_500),
    holdingsValueStart: egp(50_000),
    holdingsValueEnd: egp(63_500),
    liabilityUpdates: [],
    allocationEvents: [
      { date: "2026-03-12", delta: egp(7_000) },
      { date: "2026-03-15", delta: egp(5_000) },
      { date: "2026-03-20", delta: egp(2_000) },
    ],
  });

  it("matches every figure", () => {
    expect(review).toEqual({
      earnedIncome: egp(30_000),
      investmentIncome: 0,
      totalIncome: egp(30_000),
      spending: egp(12_000),
      saved: egp(18_000),
      savingsRate: 0.6,
      invested: egp(10_000),
      keptAsCash: egp(8_000),
      marketChange: egp(3_500),
      netWorthChange: egp(21_500),
      adjustments: 0,
      goalAllocations: egp(14_000),
      unallocated: egp(4_000),
      reconciles: true,
      difference: 0,
    });
  });
});

describe("a busy month reconciles to the piaster", () => {
  // Bank 100,000 + stock and cloud worth 30,000 at the start, a 50,000 loan.
  const OPENING_BANK = egp(100_000);
  const LOAN = egp(50_000);
  const txs: Tx[] = [
    tx({ type: "INCOME", amount: egp(30_000), toAccountId: "bank", date: "2026-03-01" }),
    tx({ type: "EXPENSE", amount: egp(8_000), fromAccountId: "bank", date: "2026-03-02" }),
    tx({ type: "EXPENSE", amount: egp(500), fromAccountId: "bank", date: "2026-03-05" }), // loan interest
    tx({ type: "LIABILITY_PAYMENT", amount: egp(2_000), fromAccountId: "bank", date: "2026-03-05" }), // principal
    tx({ type: "INVESTMENT_PURCHASE", amount: egp(5_025), fromAccountId: "bank", date: "2026-03-08" }), // 5,000 + 25 fee
    tx({ type: "INVESTMENT_SALE", amount: egp(3_000), toAccountId: "bank", date: "2026-03-12" }),
    tx({ type: "DIVIDEND", amount: egp(400), toAccountId: "bank", date: "2026-03-20" }),
    tx({ type: "ADJUSTMENT", amount: egp(-100), toAccountId: "bank", date: "2026-03-22" }),
  ];
  const liabilityUpdates = [{ date: "2026-03-15", delta: egp(1_000) }]; // borrowed 1,000 more, no cash moved
  const principalPaid = [{ date: "2026-03-05", amount: egp(2_000) }];
  // Stock 20,000 + 5,000 bought - 3,000 sold + 800 price move; cloud 10,000 + 150 accrual.
  const holdingsStart = egp(30_000);
  const holdingsEnd = egp(22_800) + egp(10_150);

  const nwStart = netWorth({
    cash: accountBalance(OPENING_BANK, "bank", []),
    holdings: holdingsStart,
    liabilities: outstanding(LOAN, [], [], "2026-02-28"),
  });
  const nwEnd = netWorth({
    cash: accountBalance(OPENING_BANK, "bank", txs),
    holdings: holdingsEnd,
    liabilities: outstanding(LOAN, liabilityUpdates, principalPaid, "2026-03-31"),
  });
  const input = {
    range: RANGE,
    txs,
    netWorthStart: nwStart,
    netWorthEnd: nwEnd,
    holdingsValueStart: holdingsStart,
    holdingsValueEnd: holdingsEnd,
    liabilityUpdates,
    allocationEvents: [],
  };

  it("reconciles with a difference of exactly 0", () => {
    const r = monthlyReview(input);
    expect(r.reconciles).toBe(true);
    expect(r.difference).toBe(0);
    expect(r.netWorthChange).toBe(egp(21_725));
  });

  it("shows each piece", () => {
    const r = monthlyReview(input);
    expect(r.totalIncome).toBe(egp(30_400)); // salary + dividend
    expect(r.investmentIncome).toBe(egp(400));
    expect(r.spending).toBe(egp(8_500)); // principal and the purchase are not spending
    expect(r.saved).toBe(egp(21_900));
    expect(r.invested).toBe(egp(2_025)); // purchase with fee - sale
    expect(r.keptAsCash).toBe(egp(19_875));
    expect(r.marketChange).toBe(egp(925)); // 800 + 150 - the 25 fee
    expect(r.adjustments).toBe(egp(-1_100)); // -100 ledger, -1,000 more debt
    expect(r.unallocated).toBe(egp(21_900));
  });

  it("ignores rows outside the month", () => {
    const outside = [
      ...txs,
      tx({ type: "EXPENSE", amount: egp(9_999), fromAccountId: "bank", date: "2026-04-01" }),
      tx({ type: "INCOME", amount: egp(9_999), toAccountId: "bank", date: "2026-02-28" }),
    ];
    const r = monthlyReview({
      ...input,
      txs: outside,
      liabilityUpdates: [...liabilityUpdates, { date: "2026-04-02", delta: egp(777) }],
      allocationEvents: [{ date: "2026-04-02", delta: egp(5) }],
    });
    expect([r.spending, r.adjustments, r.goalAllocations, r.difference]).toEqual([egp(8_500), egp(-1_100), 0, 0]);
  });

  it("pending and void rows change nothing", () => {
    const r = monthlyReview({
      ...input,
      txs: [...txs, tx({ type: "EXPENSE", amount: egp(777), fromAccountId: "bank", status: "pending" }), tx({ type: "INCOME", amount: egp(5), toAccountId: "bank", status: "void" })],
    });
    expect([r.spending, r.difference]).toEqual([egp(8_500), 0]);
  });

  it("reports a non-zero difference plainly when the inputs are broken", () => {
    const oneOff = monthlyReview({ ...input, netWorthEnd: nwEnd + 1 });
    expect([oneOff.reconciles, oneOff.difference]).toEqual([false, 1]);

    const forgotLoanUpdate = monthlyReview({ ...input, liabilityUpdates: [] });
    expect([forgotLoanUpdate.reconciles, forgotLoanUpdate.difference]).toEqual([false, egp(-1_000)]);
  });
});

describe("edge cases", () => {
  const empty = {
    range: RANGE,
    txs: [],
    netWorthStart: 0,
    netWorthEnd: 0,
    holdingsValueStart: 0,
    holdingsValueEnd: 0,
    liabilityUpdates: [],
    allocationEvents: [],
  };

  it("an empty month reconciles with no savings rate", () => {
    expect(monthlyReview(empty)).toMatchObject({ saved: 0, savingsRate: null, reconciles: true, unallocated: 0 });
  });

  it("a deficit month is negative savings; more earmarked than saved leaves a negative remainder", () => {
    const r = monthlyReview({
      ...empty,
      txs: [tx({ type: "EXPENSE", amount: egp(500), fromAccountId: "bank" })],
      netWorthEnd: egp(-500),
      allocationEvents: [{ date: "2026-03-05", delta: egp(200) }],
    });
    expect([r.saved, r.keptAsCash, r.unallocated, r.reconciles]).toEqual([egp(-500), egp(-500), egp(-700), true]);
  });

  it("a withdrawn earmark is a negative allocation", () => {
    const r = monthlyReview({ ...empty, allocationEvents: [{ date: "2026-03-05", delta: egp(-300) }] });
    expect(r.goalAllocations).toBe(egp(-300));
  });
});
