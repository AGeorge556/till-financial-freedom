import { describe, expect, it } from "vitest";
import {
  accountFree,
  actualContribution,
  blendedReturn,
  goalCurrentAmount,
  goalProjection,
  overAllocatedBy,
  plannedMonthly,
  trailingCapacity,
  validateAllocationChange,
} from "./goals";
import { accountBalance, netWorth, type Tx } from "./ledger";
import { egpToPiasters as egp } from "./money";
import { financialMonth } from "./time";

describe("goalCurrentAmount", () => {
  it.each([
    [[egp(100), egp(50)], egp(999), { amount: egp(150), source: "allocations" }],
    [[], egp(999), { amount: egp(999), source: "manual" }],
    [[], null, { amount: 0, source: "manual" }],
  ])("%j with manual %j", (allocations, manual, expected) => {
    expect(goalCurrentAmount(allocations, manual)).toEqual(expected);
  });
});

describe("accountFree / overAllocatedBy", () => {
  it.each([
    [egp(100000), egp(58000), egp(42000), 0],
    [egp(100000), egp(100000), 0, 0],
    [egp(50000), egp(60000), 0, egp(10000)],
    [egp(-2000), 0, 0, 0],
    [egp(-2000), egp(5000), 0, egp(5000)],
  ])("balance %i allocated %i -> free %i, over %i", (balance, allocated, free, over) => {
    expect(accountFree(balance, allocated)).toBe(free);
    expect(overAllocatedBy(balance, allocated)).toBe(over);
  });
});

describe("validateAllocationChange", () => {
  it.each([
    ["new allocation within free", egp(100000), egp(60000), 0, egp(40000), { ok: true }],
    ["new allocation above free", egp(100000), egp(60000), 0, egp(40001), { ok: false, error: "exceeds-free", free: egp(40000) }],
    ["increase is checked by its delta", egp(10000), egp(10000), egp(5000), egp(8000), { ok: false, error: "exceeds-free", free: 0 }],
    ["increase fits in the free part", egp(13000), egp(10000), egp(5000), egp(8000), { ok: true }],
    ["decrease passes while over-allocated", egp(5000), egp(10000), egp(6000), egp(2000), { ok: true }],
    ["unchanged passes while over-allocated", egp(5000), egp(10000), egp(6000), egp(6000), { ok: true }],
    ["zero removes the allocation", egp(5000), egp(10000), egp(6000), 0, { ok: true }],
    ["negative is invalid", egp(5000), 0, 0, -1, { ok: false, error: "invalid-amount" }],
    ["fractional piasters are invalid", egp(5000), 0, 0, 1.5, { ok: false, error: "invalid-amount" }],
  ])("%s", (_name, balance, total, current, next, expected) => {
    expect(validateAllocationChange(balance, total, current, next)).toEqual(expected);
  });
});

describe("actualContribution", () => {
  const events = [
    { date: "2026-09-24", delta: egp(9000) }, // previous financial month (start day 25)
    { date: "2026-09-25", delta: egp(1000) },
    { date: "2026-10-10", delta: egp(2500) },
    { date: "2026-10-24", delta: -egp(500) },
    { date: "2026-10-25", delta: egp(7000) }, // next financial month
  ];

  it("counts only events inside the financial month, netting withdrawals", () => {
    const month = financialMonth("2026-10-03", 25);
    expect(month).toEqual({ start: "2026-09-25", end: "2026-10-24" });
    expect(actualContribution(events, month)).toBe(egp(3000));
    expect(actualContribution(events, financialMonth("2026-10-25", 25))).toBe(egp(7000));
    expect(actualContribution([], month)).toBe(0);
  });
});

describe("allocating is not a ledger transaction", () => {
  it("changes free money but leaves the account balance and net worth untouched", () => {
    const txs: Tx[] = [{ type: "INCOME", date: "2026-10-01", amount: egp(50000), toAccountId: "bank", status: "posted" }];
    const balanceBefore = accountBalance(egp(10000), "bank", txs);
    const netWorthBefore = netWorth({ cash: balanceBefore, holdings: 0, liabilities: 0 });
    expect(accountFree(balanceBefore, 0)).toBe(egp(60000));

    expect(validateAllocationChange(balanceBefore, 0, 0, egp(25000))).toEqual({ ok: true });
    const allocated = egp(25000);

    expect(accountBalance(egp(10000), "bank", txs)).toBe(balanceBefore);
    expect(netWorth({ cash: accountBalance(egp(10000), "bank", txs), holdings: 0, liabilities: 0 })).toBe(netWorthBefore);
    expect(accountFree(balanceBefore, allocated)).toBe(egp(35000));
  });
});

describe("blendedReturn", () => {
  it.each([
    ["value-weighted", [{ value: egp(300), rate: 0.1 }, { value: egp(100), rate: 0.3 }], undefined, 0.15, "blended"],
    ["override wins", [{ value: egp(300), rate: 0.1 }], 0.2, 0.2, "override"],
    ["override of 0 still wins", [{ value: egp(300), rate: 0.1 }], 0, 0, "override"],
    ["unset rate counts as 0", [{ value: egp(100), rate: null }, { value: egp(100), rate: 0.2 }], null, 0.1, "blended"],
    ["zero total value is 0", [{ value: 0, rate: 0.2 }], undefined, 0, "blended"],
    ["no sources is 0", [], undefined, 0, "blended"],
  ])("%s", (_name, sources, override, rate, source) => {
    const result = blendedReturn(sources, override);
    expect(result.rate).toBeCloseTo(rate, 12);
    expect(result.source).toBe(source);
  });
});

describe("plannedMonthly", () => {
  it.each([
    [egp(5000), egp(1000), { amount: egp(5000), source: "rules" }],
    [0, egp(1000), { amount: 0, source: "rules" }], // a rule targets it but funds nothing: the goal's own figure is ignored
    [null, egp(1000), { amount: egp(1000), source: "goal" }],
    [null, null, { amount: 0, source: "goal" }],
  ])("rule %j, goal %j", (ruleFunded, goalPlanned, expected) => {
    expect(plannedMonthly(ruleFunded, goalPlanned)).toEqual(expected);
  });
});

describe("goalProjection", () => {
  // 2026-10-03, month starts on the 1st, nothing contributed yet: Oct 2026 .. Nov 2030 is 50 month-ends.
  const realEstate = {
    target: egp(1500000),
    current: egp(300000),
    annualReturn: 0.12,
    today: "2026-10-03",
    targetDate: "2030-11-30",
    startDay: 1,
    contributedThisMonth: false,
  };

  it("Real Estate fixture: ~16,020 required, 15,000 a month is 3 months late", () => {
    const result = goalProjection({ ...realEstate, plannedMonthly: egp(15000) });
    expect(result.monthsRemaining).toBe(50);
    expect(result.required).toBe(1602018);
    expect(result.onTrack).toBe(false);
    expect(result.monthsLate).toBe(3);
    expect(result.projectedMonths).toBe(53);
    expect(result.gap).toBe(result.projectedAtTarget - realEstate.target);
    expect(result.gap).toBeLessThan(0);
  });

  it("paying the required amount reaches the target on time", () => {
    const result = goalProjection({ ...realEstate, plannedMonthly: 1602018 });
    expect(result.onTrack).toBe(true);
    expect(result.gap).toBeGreaterThanOrEqual(0);
    expect(result.monthsLate).toBeLessThanOrEqual(0);
  });

  it("having contributed this month removes one contribution date", () => {
    expect(goalProjection({ ...realEstate, plannedMonthly: 0, contributedThisMonth: true }).monthsRemaining).toBe(49);
  });

  it("0% return: required is a straight line, and exactly on the line is on track with no gap", () => {
    const result = goalProjection({
      target: egp(120000),
      current: 0,
      plannedMonthly: egp(10000),
      annualReturn: 0,
      today: "2026-10-03",
      targetDate: "2027-09-30",
      startDay: 1,
      contributedThisMonth: false,
    });
    expect(result).toMatchObject({ monthsRemaining: 12, required: egp(10000), onTrack: true, gap: 0, monthsLate: 0, projectedMonths: 12 });
  });

  it("nothing planned and no return can never reach the target", () => {
    const result = goalProjection({ ...realEstate, annualReturn: 0, plannedMonthly: 0 });
    expect(result).toMatchObject({ onTrack: false, monthsLate: null, projectedMonths: "unreachable" });
  });

  it("already reached: nothing required, early, on track", () => {
    const result = goalProjection({ ...realEstate, current: egp(1600000), plannedMonthly: 0 });
    expect(result.required).toBe(0);
    expect(result.onTrack).toBe(true);
    expect(result.projectedMonths).toBe(0);
    expect(result.monthsLate).toBe(-50);
  });

  it("target date passed is a state, not a number, unless the goal was reached", () => {
    const passed = { ...realEstate, targetDate: "2026-09-30", plannedMonthly: egp(15000) };
    const short = goalProjection(passed);
    expect(short.monthsRemaining).toBe(0);
    expect(short.required).toBe("target-date-passed");
    expect(short.onTrack).toBe(false);
    expect(goalProjection({ ...passed, current: egp(1500000) }).required).toBe(0);
  });
});

describe("trailingCapacity", () => {
  const month = (income: number, spending: number, full = true) => ({ income: egp(income), spending: egp(spending), full });

  it("needs 3 full months", () => {
    expect(trailingCapacity([])).toBeNull();
    expect(trailingCapacity([month(50000, 30000), month(50000, 30000)])).toBeNull();
    expect(trailingCapacity([month(50000, 30000), month(50000, 30000), month(50000, 30000, false)])).toBeNull();
  });

  it("averages the last 3 full months", () => {
    const result = trailingCapacity([month(1, 1), month(50000, 30000), month(52000, 31000), month(54000, 35000), month(60000, 20000, false)]);
    expect(result).toEqual({ income: egp(52000), spending: egp(32000), capacity: egp(20000) });
  });

  it("rounds each average to whole piasters and allows negative capacity", () => {
    const result = trailingCapacity([
      { income: 100, spending: 400, full: true },
      { income: 100, spending: 400, full: true },
      { income: 101, spending: 401, full: true },
    ]);
    expect(result).toEqual({ income: 100, spending: 400, capacity: -300 });
  });
});
