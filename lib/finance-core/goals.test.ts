import { describe, expect, it } from "vitest";
import {
  accountFree,
  actualContribution,
  attributeOverAllocation,
  blendedReturn,
  emergencyTarget,
  goalCurrentAmount,
  goalProjection,
  holdingFreeShare,
  overAllocatedBy,
  plannedMonthly,
  shareChangeEvent,
  shareValue,
  shareValues,
  sourceReturn,
  trailingCapacity,
  validateAllocationChange,
  validateShareChange,
} from "./goals";
import { accountBalance, netWorth, type Tx } from "./ledger";
import { egpToPiasters as egp } from "./money";
import { financialMonth } from "./time";

const cash = (amountEgp: number) => ({ kind: "cash" as const, amount: egp(amountEgp) });
const share = (percent: string, holdingValueEgp: number) => ({
  kind: "holding" as const,
  percent,
  holdingValue: egp(holdingValueEgp),
});

describe("goalCurrentAmount", () => {
  it.each([
    [[cash(100), cash(50)], egp(999), { amount: egp(150), source: "allocations" }],
    [[cash(100), share("0.25", 400)], egp(999), { amount: egp(200), source: "allocations" }],
    [[share("1", 400)], null, { amount: egp(400), source: "allocations" }],
    [[], egp(999), { amount: egp(999), source: "manual" }],
    [[], null, { amount: 0, source: "manual" }],
  ])("%j with manual %j", (allocations, manual, expected) => {
    expect(goalCurrentAmount(allocations, manual)).toEqual(expected);
  });

  it("a holding share follows the holding price; cash does not", () => {
    const at = (holdingValueEgp: number) => goalCurrentAmount([cash(10_000), share("0.25", holdingValueEgp)], null).amount;
    expect(at(40_000)).toBe(egp(20_000));
    expect(at(60_000)).toBe(egp(25_000)); // the holding rose 50%, the share part rose with it
    expect(at(20_000)).toBe(egp(15_000)); // and falls with it
  });
});

describe("shareValue", () => {
  it.each([
    [egp(40_000), "0.25", egp(10_000)],
    [egp(40_000), "1", egp(40_000)],
    [egp(40_000), "0", 0],
    [1, "0.5", 1], // 0.5 piaster rounds half up
    [1, "0.4", 0],
    [3, "0.333333", 1], // 0.999999
    [123_456_789, "0.123457", 15_241_605], // 15,241,604.799573
    [0, "0.7", 0],
  ])("%i x %s -> %i", (value, percent, expected) => {
    expect(shareValue(value, percent)).toBe(expected);
  });

  it.each([
    ["a negative value", () => shareValue(-1, "0.5")],
    ["a fractional-piaster value", () => shareValue(1.5, "0.5")],
    ["a 7-decimal share", () => shareValue(100, "0.1234567")],
    ["a negative share", () => shareValue(100, "-0.1")],
  ])("refuses %s", (_name, fn) => {
    expect(fn).toThrow(RangeError);
  });
});

describe("holdingFreeShare", () => {
  it.each([
    [[], "1"],
    [["0.3", "0.45"], "0.25"],
    [["0.1", "0.2"], "0.7"], // 1 - 0.1 - 0.2 in floats is 0.7000000000000001
    [["0.333333", "0.333333", "0.333333"], "0.000001"],
    [["1"], "0"],
    [["0.7", "0.4"], "0"], // never negative, even if the data is already over
  ])("%j -> %s", (percents, expected) => {
    expect(holdingFreeShare(percents)).toBe(expected);
  });
});

describe("validateShareChange", () => {
  it.each([
    ["a first share within the free part", "0.7", "0", "0.3", { ok: true }],
    ["exactly the free part, where floats say 0.7 + 0.3 is not 1", "0.7", "0", "0.300000", { ok: true }],
    ["one millionth above the free part", "0.7", "0", "0.300001", { ok: false, error: "exceeds-free", free: "0.3" }],
    ["an increase is checked by its delta", "0.9", "0.5", "0.6", { ok: true }],
    ["an increase above the free part", "0.9", "0.5", "0.61", { ok: false, error: "exceeds-free", free: "0.1" }],
    ["a full share of an unclaimed holding", "0", "0", "1", { ok: true }],
    ["the last millionth", "0.999999", "0", "0.000001", { ok: true }],
    ["two millionths when one is free", "0.999999", "0", "0.000002", { ok: false, error: "exceeds-free", free: "0.000001" }],
    ["a decrease passes while the holding is over 100%", "1.2", "0.6", "0.3", { ok: true }],
    ["unchanged passes while over 100%", "1.2", "0.6", "0.6", { ok: true }],
    ["zero removes the share", "1", "0.6", "0", { ok: true }],
    ["above 100% for a single goal", "0", "0", "1.000001", { ok: false, error: "invalid-percent" }],
    ["negative", "0", "0", "-0.1", { ok: false, error: "invalid-percent" }],
    ["seven decimals", "0", "0", "0.1234567", { ok: false, error: "invalid-percent" }],
    ["not a number", "0", "0", "abc", { ok: false, error: "invalid-percent" }],
  ])("%s", (_name, total, current, next, expected) => {
    expect(validateShareChange(total, current, next)).toEqual(expected);
  });

  it("a third goal taking the holding over 100% is refused", () => {
    // goals A and B hold 0.5 and 0.3 of one stock
    expect(validateShareChange("0.8", "0", "0.2")).toEqual({ ok: true });
    expect(validateShareChange("0.8", "0", "0.200001")).toEqual({ ok: false, error: "exceeds-free", free: "0.2" });
  });
});

describe("shareChangeEvent", () => {
  it.each([
    ["a new share is valued at today price", "0", "0.25", egp(40_000), { percentDelta: "0.25", delta: egp(10_000) }],
    ["an increase is the difference only", "0.25", "0.4", egp(40_000), { percentDelta: "0.15", delta: egp(6_000) }],
    ["a decrease is negative", "0.25", "0.1", egp(50_000), { percentDelta: "-0.15", delta: -egp(7_500) }],
    ["removing a share", "0.4", "0", egp(50_000), { percentDelta: "-0.4", delta: -egp(20_000) }],
    ["rounds the EGP value half up", "0", "0.000001", 5_000_000, { percentDelta: "0.000001", delta: 5 }],
    ["a value of 0.5 piaster rounds up", "0", "0.000001", 500_000, { percentDelta: "0.000001", delta: 1 }],
  ])("%s", (_name, current, next, holdingValue, expected) => {
    expect(shareChangeEvent(current, next, holdingValue)).toEqual(expected);
  });

  it("no change is no event", () => {
    expect(shareChangeEvent("0.25", "0.25", egp(40_000))).toBeNull();
  });

  it("the event value is frozen at the moment: later market growth is not a contribution", () => {
    const month = { start: "2026-10-01", end: "2026-10-31" };
    const event = shareChangeEvent("0", "0.25", egp(40_000))!;
    const events = [{ date: "2026-10-05", delta: event.delta }];
    // the holding doubles; the goal value follows it but the contribution stays what was set aside
    expect(goalCurrentAmount([share("0.25", 80_000)], null).amount).toBe(egp(20_000));
    expect(actualContribution(events, month)).toBe(egp(10_000));
    // selling down is a negative contribution at that day's price
    const down = shareChangeEvent("0.25", "0.15", egp(80_000))!;
    expect(actualContribution([...events, { date: "2026-10-20", delta: down.delta }], month)).toBe(egp(10_000) - egp(8_000));
  });
});

describe("sourceReturn and the blended return per source (rule A3)", () => {
  const assumed = { cashReturn: 0.05, stockReturn: 0.12, goldReturn: 0.08 };

  it.each([
    [{ kind: "cash" as const }, 0.05],
    [{ kind: "stock" as const }, 0.12],
    [{ kind: "fund" as const }, 0.12],
    [{ kind: "other" as const }, 0.12],
    [{ kind: "gold" as const }, 0.08],
    [{ kind: "cloud" as const, apy: 0.18 }, 0.18],
    [{ kind: "cloud" as const, apy: null }, null],
  ])("%j -> %s", (source, expected) => {
    expect(sourceReturn(source, assumed)).toBe(expected);
  });

  it("an unset assumption is null", () => {
    expect(sourceReturn({ kind: "gold" }, { cashReturn: null, stockReturn: null, goldReturn: null })).toBeNull();
  });

  it("is value-weighted across cash, stock, gold and a cloud", () => {
    // 100k cash @5%, 200k stock @12%, 100k gold @8%, 100k cloud @18% -> (5 + 24 + 8 + 18) / 5 = 11%
    const sources = [
      { value: egp(100_000), rate: sourceReturn({ kind: "cash" }, assumed) },
      { value: egp(200_000), rate: sourceReturn({ kind: "stock" }, assumed) },
      { value: egp(100_000), rate: sourceReturn({ kind: "gold" }, assumed) },
      { value: egp(100_000), rate: sourceReturn({ kind: "cloud", apy: 0.18 }, assumed) },
    ];
    const blended = blendedReturn(sources);
    expect(blended.rate).toBeCloseTo(0.11, 12);
    expect(blended.source).toBe("blended");
    expect(blendedReturn(sources, 0.2)).toEqual({ rate: 0.2, source: "override" });
  });

  it("a cloud with no APY set counts as 0", () => {
    const sources = [
      { value: egp(100_000), rate: sourceReturn({ kind: "gold" }, assumed) },
      { value: egp(100_000), rate: sourceReturn({ kind: "cloud", apy: null }, assumed) },
    ];
    expect(blendedReturn(sources).rate).toBeCloseTo(0.04, 12);
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

describe("attributeOverAllocation", () => {
  const a = (id: string, amountEgp: number) => ({ id, amount: egp(amountEgp) });
  const newestFirst = [a("c", 30), a("b", 20), a("a", 10)];
  const total = (m: Map<string, number>) => [...m.values()].reduce((s, x) => s + x, 0);

  it.each([
    ["nothing over", 0, [0, 0, 0]],
    ["over by less than the newest", 12, [12, 0, 0]],
    ["over by exactly the newest", 30, [30, 0, 0]],
    ["spills into the next", 35, [30, 5, 0]],
    ["every allocation", 60, [30, 20, 10]],
  ])("%s", (_name, overEgp, expected) => {
    const shares = attributeOverAllocation(egp(overEgp), newestFirst);
    expect([...shares.values()]).toEqual(expected.map(egp));
    expect([...shares.keys()]).toEqual(["c", "b", "a"]);
    expect(total(shares)).toBe(egp(overEgp)); // always exactly the account figure
  });

  it("agrees with overAllocatedBy: balance 25 against 60 allocated is over by 35", () => {
    const over = overAllocatedBy(egp(25), egp(60));
    expect(total(attributeOverAllocation(over, newestFirst))).toBe(over);
  });

  it("works to the piaster", () => {
    const shares = attributeOverAllocation(7, [{ id: "x", amount: 3 }, { id: "y", amount: 3 }, { id: "z", amount: 3 }]);
    expect([...shares.values()]).toEqual([3, 3, 1]);
  });

  it("no allocations and nothing over is empty; an over-allocation with nothing to blame is inconsistent", () => {
    expect(attributeOverAllocation(0, []).size).toBe(0);
    expect(() => attributeOverAllocation(1, [])).toThrow(RangeError);
    expect(() => attributeOverAllocation(egp(61), newestFirst)).toThrow(RangeError);
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

describe("shareValues", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it("independent half-up rounding overshoots the holding; largest remainder does not", () => {
    // 0.5 piaster each, twice: shareValue rounds both up to 1 and 2 > 1 piaster.
    expect(sum([shareValue(1, "0.5"), shareValue(1, "0.5")])).toBe(2);
    expect(shareValues(1, ["0.5", "0.5"])).toEqual([1, 0]);
    expect(shareValues(2, ["0.25", "0.25", "0.25", "0.25"])).toEqual([1, 1, 0, 0]);
  });

  it.each([
    [egp(40_000), ["0.25", "0.75"], [egp(10_000), egp(30_000)]],
    [100, ["0.333333", "0.333333", "0.333334"], [33, 33, 34]],
    [10, ["0.333333", "0.333333", "0.333334"], [3, 3, 4]],
    [7, ["0.5", "0.5"], [4, 3]], // exact 3.5 each: the earlier share gets the extra piaster
    [5, ["1"], [5]],
    [0, ["0.4", "0.6"], [0, 0]],
    [123_457, ["0.1", "0.2", "0.3", "0.4"], [12_346, 24_691, 37_037, 49_383]], // exact .7, .4, .1, .8
  ])("%i over %j -> %j, summing to the holding at 100%", (value, shares, expected) => {
    const parts = shareValues(value, shares);
    expect(parts).toEqual(expected);
    expect(sum(parts)).toBe(value);
  });

  it("under 100% the parts sum to the rounded total share and never exceed the holding", () => {
    const parts = shareValues(1_000, ["0.1234", "0.2345"]);
    expect(sum(parts)).toBe(358); // 35.79% of 1,000 = 357.9
    expect(sum(parts)).toBeLessThanOrEqual(1_000);
    expect(shareValues(3, ["0.5"])).toEqual([2]); // single share = shareValue
    expect(shareValues(1, ["0.4"])).toEqual([0]);
  });

  it("each part is within one piaster of its exact value", () => {
    const shares = ["0.123457", "0.234567", "0.345679", "0.296297"];
    const value = 987_654_321;
    shareValues(value, shares).forEach((part, i) => {
      const exact = (value * Number(shares[i])) ;
      expect(Math.abs(part - exact)).toBeLessThan(1);
    });
  });

  it("is empty for no shares and refuses bad input", () => {
    expect(shareValues(100, [])).toEqual([]);
    expect(() => shareValues(100, ["0.6", "0.5"])).toThrow(RangeError);
    expect(() => shareValues(-1, ["0.5"])).toThrow(RangeError);
    expect(() => shareValues(1.5, ["0.5"])).toThrow(RangeError);
    expect(() => shareValues(100, ["0.1234567"])).toThrow(RangeError);
  });
});

describe("emergencyTarget (E1)", () => {
  it.each([
    ["no history", 3, [], { kind: "not-enough-history" }],
    ["one full month", 3, [egp(10_000)], { kind: "target", target: egp(30_000), monthlyEssential: egp(10_000), monthsUsed: 1 }],
    ["fewer than 6: average of what exists", 6, [egp(10_000), egp(12_000)], { kind: "target", target: egp(66_000), monthlyEssential: egp(11_000), monthsUsed: 2 }],
    ["exactly 6", 3, [egp(1_000), egp(2_000), egp(3_000), egp(4_000), egp(5_000), egp(6_000)], { kind: "target", target: egp(10_500), monthlyEssential: egp(3_500), monthsUsed: 6 }],
    ["more than 6: only the latest 6", 3, [egp(90_000), egp(1_000), egp(2_000), egp(3_000), egp(4_000), egp(5_000), egp(6_000)], { kind: "target", target: egp(10_500), monthlyEssential: egp(3_500), monthsUsed: 6 }],
    ["rounded once, after multiplying", 3, [1, 1, 2], { kind: "target", target: 4, monthlyEssential: 1, monthsUsed: 3 }], // 4/3 x 3 = 4, not 1 x 3
  ])("%s", (_name, months, totals, expected) => {
    expect(emergencyTarget({ months, essentialMonthlyTotals: totals })).toEqual(expected);
  });

  it.each([0, 61, 1.5])("refuses %s months", (months) => {
    expect(() => emergencyTarget({ months, essentialMonthlyTotals: [100] })).toThrow(RangeError);
  });
});
