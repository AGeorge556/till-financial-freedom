import { describe, expect, it } from "vitest";
import {
  change,
  DEFAULT_NOTABLE_AMOUNT,
  DEFAULT_NOTABLE_PERCENT,
  fullMonths,
  incomeByCategory,
  monthToDateComparison,
  monthTotals,
  spendingBy,
  trailingAverage,
  yearOverYear,
  type CategorizedTx,
} from "./analytics";
import { egpToPiasters as egp } from "./money";

const exp = (date: string, amountEgp: number, over: Partial<CategorizedTx> = {}): CategorizedTx => ({
  type: "EXPENSE",
  date,
  amount: egp(amountEgp),
  fromAccountId: "bank",
  status: "posted",
  ...over,
});

describe("spendingBy", () => {
  const txs = [
    exp("2026-03-01", 100, { categoryId: "food" }),
    exp("2026-03-02", 250, { categoryId: "rent", fromAccountId: "card" }),
    exp("2026-03-03", 50, { categoryId: "food", fromAccountId: "card" }),
    exp("2026-03-04", 30),
    exp("2026-03-05", 999, { categoryId: "food", status: "pending" }),
    exp("2026-03-05", 999, { categoryId: "food", status: "void" }),
    exp("2026-03-06", 999, { type: "TRANSFER", categoryId: "food", toAccountId: "card" }),
    exp("2026-03-06", 999, { type: "INCOME", categoryId: "food", fromAccountId: undefined, toAccountId: "bank" }),
  ];

  it("groups posted spending by category, largest first, uncategorised as null", () => {
    expect(spendingBy(txs, "category")).toEqual([
      { key: "rent", total: egp(250) },
      { key: "food", total: egp(150) },
      { key: null, total: egp(30) },
    ]);
  });

  it("groups by paying account", () => {
    expect(spendingBy(txs, "account")).toEqual([
      { key: "card", total: egp(300) },
      { key: "bank", total: egp(130) },
    ]);
  });

  it("is empty when nothing was spent", () => {
    expect(spendingBy([exp("2026-03-01", 10, { status: "pending" })], "category")).toEqual([]);
  });
});

describe("incomeByCategory", () => {
  const inc = (amountEgp: number, over: Partial<CategorizedTx> = {}): CategorizedTx => ({
    type: "INCOME",
    date: "2026-03-01",
    amount: egp(amountEgp),
    toAccountId: "bank",
    status: "posted",
    ...over,
  });

  it("groups posted earned income by category, largest first, with shares of the earned total", () => {
    const out = incomeByCategory([
      inc(1_000, { categoryId: "side" }),
      inc(6_000, { categoryId: "salary" }),
      inc(2_000, { categoryId: "salary" }),
      inc(1_000),
    ]);
    expect(out).toEqual([
      { key: "salary", total: egp(8_000), share: 0.8 },
      { key: "side", total: egp(1_000), share: 0.1 },
      { key: null, total: egp(1_000), share: 0.1 },
    ]);
  });

  it("leaves out pending, void, dividends, interest and other types", () => {
    const out = incomeByCategory([
      inc(100, { categoryId: "salary" }),
      inc(900, { categoryId: "salary", status: "pending" }),
      inc(900, { categoryId: "salary", status: "void" }),
      inc(900, { categoryId: "salary", type: "DIVIDEND" }),
      inc(900, { categoryId: "salary", type: "INTEREST" }),
      exp("2026-03-01", 900, { categoryId: "salary" }),
    ]);
    expect(out).toEqual([{ key: "salary", total: egp(100), share: 1 }]);
  });

  it("is empty when nothing was earned", () => {
    expect(incomeByCategory([])).toEqual([]);
  });
});

describe("monthTotals", () => {
  it("summarises each month with the ledger rules", () => {
    const txs = [
      exp("2026-01-10", 100),
      exp("2026-02-10", 300),
      { type: "INCOME", date: "2026-02-01", amount: egp(1_000), toAccountId: "bank", status: "posted" } as CategorizedTx,
    ];
    const months = [
      { start: "2026-01-01", end: "2026-01-31" },
      { start: "2026-02-01", end: "2026-02-28" },
    ];
    expect(monthTotals(txs, months).map((m) => [m.spending, m.income, m.savings])).toEqual([
      [egp(100), 0, egp(-100)],
      [egp(300), egp(1_000), egp(700)],
    ]);
  });
});

describe("fullMonths", () => {
  it.each([
    ["data from the 1st of Jan", "2026-01-01", "2026-04-10", 1, 6, ["2026-01-01", "2026-02-01", "2026-03-01"]],
    ["data from mid Jan: January is not full", "2026-01-15", "2026-04-10", 1, 6, ["2026-02-01", "2026-03-01"]],
    ["no data at all", null, "2026-04-10", 1, 6, []],
    ["data starts this month", "2026-04-03", "2026-04-10", 1, 6, []],
    ["capped at max, most recent kept", "2025-01-01", "2026-04-10", 1, 2, ["2026-02-01", "2026-03-01"]],
    ["month starting on the 25th", "2026-01-25", "2026-04-10", 25, 6, ["2026-01-25", "2026-02-25"]],
  ])("%s", (_name, first, today, startDay, max, expectedStarts) => {
    expect(fullMonths(first, today, startDay, max).map((m) => m.start)).toEqual(expectedStarts);
  });

  it("returns whole month ranges", () => {
    expect(fullMonths("2026-01-01", "2026-03-10", 1, 6)).toEqual([
      { start: "2026-01-01", end: "2026-01-31" },
      { start: "2026-02-01", end: "2026-02-28" },
    ]);
  });
});

describe("trailingAverage (N2)", () => {
  it.each([
    [[], { kind: "not-enough-history", fullMonths: 0 }],
    [[egp(900)], { kind: "not-enough-history", fullMonths: 1 }],
    [[egp(900), egp(1_100)], { kind: "average", value: egp(1_000) }],
    [[egp(900), egp(1_100), egp(1_300)], { kind: "average", value: egp(1_100) }],
    [[egp(5_000), egp(900), egp(1_100), egp(1_300)], { kind: "average", value: egp(1_100) }], // only the last 3
  ])("%j", (values, expected) => {
    expect(trailingAverage(values)).toEqual(expected);
  });

  it("rounds to whole piasters", () => {
    expect(trailingAverage([1, 1, 2])).toEqual({ kind: "average", value: 1 }); // 1.33
    expect(trailingAverage([1, 2])).toEqual({ kind: "average", value: 2 }); // 1.5 half up
  });
});

describe("monthToDateComparison (N3)", () => {
  const march = { start: "2026-03-01", end: "2026-03-31" };
  const jan = { start: "2026-01-01", end: "2026-01-31" };
  const feb = { start: "2026-02-01", end: "2026-02-28" };
  const txs = [
    exp("2026-01-05", 100),
    exp("2026-01-25", 900),
    exp("2026-02-03", 200),
    exp("2026-02-20", 800),
    exp("2026-03-02", 400),
    exp("2026-03-20", 7_000),
  ];

  it("compares month-to-date with the same days of earlier months, not whole months", () => {
    const r = monthToDateComparison({ txs, currentMonth: march, today: "2026-03-10", earlierMonths: [jan, feb] });
    // days 1-10: Jan 100, Feb 200 -> 150. Whole-month average would be 1,000.
    expect(r).toEqual({ kind: "comparison", current: egp(400), baseline: egp(150) });
  });

  it("needs two earlier months", () => {
    expect(monthToDateComparison({ txs, currentMonth: march, today: "2026-03-10", earlierMonths: [feb] })).toEqual({
      kind: "not-enough-history",
      fullMonths: 1,
    });
  });

  it("once the month is over it compares whole months", () => {
    const r = monthToDateComparison({ txs, currentMonth: march, today: "2026-04-02", earlierMonths: [jan, feb] });
    expect(r).toEqual({ kind: "comparison", current: egp(7_400), baseline: egp(1_000) });
  });

  it("a shorter earlier month is compared up to its own last day", () => {
    // day 31 of March against February's 28 days
    const r = monthToDateComparison({ txs, currentMonth: march, today: "2026-03-31", earlierMonths: [jan, feb] });
    expect(r).toMatchObject({ baseline: egp(1_000) });
  });
});

describe("change (N4)", () => {
  const th = { percent: DEFAULT_NOTABLE_PERCENT, amount: DEFAULT_NOTABLE_AMOUNT };

  it.each([
    // [baseline, current, notable] in piasters
    [400_000, 460_000, true], // exactly +15% and +600 EGP
    [400_000, 459_999, false], // just under 15%
    [200_000, 250_000, true], // +25% and exactly +500 EGP
    [200_000, 249_999, false], // just under 500 EGP
    [100_000, 115_000, false], // exactly 15% but only 150 EGP
    [10_000_000, 10_050_000, false], // 500 EGP but only 0.5%
    [400_000, 340_000, true], // a fall counts the same way
    [400_000, 341_000, false],
    [0, 50_000, true], // from nothing: any rise of 500 EGP
    [0, 49_999, false],
    [0, 0, false],
  ])("baseline %i -> current %i notable=%s", (baseline, current, notable) => {
    expect(change({ current, baseline, thresholds: th }).isNotable).toBe(notable);
  });

  it("reports the absolute and percent change; percent is null from a zero baseline", () => {
    expect(change({ current: 460_000, baseline: 400_000, thresholds: th })).toEqual({ absolute: 60_000, percent: 0.15, isNotable: true });
    expect(change({ current: 50_000, baseline: 0, thresholds: th })).toMatchObject({ absolute: 50_000, percent: null });
  });

  it("uses the thresholds it is given", () => {
    expect(change({ current: 110_000, baseline: 100_000, thresholds: { percent: 0.05, amount: 5_000 } }).isNotable).toBe(true);
  });
});

describe("yearOverYear", () => {
  const txs = [
    exp("2025-01-10", 100),
    exp("2025-03-05", 200),
    exp("2025-03-20", 999), // after the same date last year
    exp("2025-12-01", 5_000),
    exp("2026-01-05", 300),
    exp("2026-03-01", 50),
  ];

  it("compares year-to-date with the same date range last year", () => {
    expect(yearOverYear({ txs, today: "2026-03-10", firstDataDate: "2025-01-01" })).toEqual({
      kind: "comparison",
      current: egp(350),
      baseline: egp(300),
    });
  });

  it("has no figure when last year is only partly covered", () => {
    expect(yearOverYear({ txs, today: "2026-03-10", firstDataDate: "2025-01-02" })).toEqual({ kind: "not-enough-history" });
    expect(yearOverYear({ txs: [], today: "2026-03-10", firstDataDate: null })).toEqual({ kind: "not-enough-history" });
  });

  it("29 Feb compares with 28 Feb of a non-leap year", () => {
    const leap = [exp("2027-02-28", 10), exp("2027-03-01", 99), exp("2028-02-29", 40)];
    expect(yearOverYear({ txs: leap, today: "2028-02-29", firstDataDate: "2027-01-01" })).toEqual({
      kind: "comparison",
      current: egp(40),
      baseline: egp(10),
    });
  });
});
