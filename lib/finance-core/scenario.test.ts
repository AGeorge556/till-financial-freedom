import { describe, expect, it } from "vitest";
import { goalProjection } from "./goals";
import { egpToPiasters as egp } from "./money";
import { futureValue, inflationAdjustedTarget, realRate } from "./projection";
import { projectScenario, type ScenarioGoal, type ScenarioInput } from "./scenario";

const zero = { stocks: 0, gold: 0, clouds: 0, cash: 0 };

const base = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({
  today: "2026-03-10",
  startDay: 1,
  monthlyIncome: egp(20_000),
  incomeGrowth: 0,
  monthlySpending: egp(12_000),
  monthlySavings: null,
  monthlyInvestment: egp(5_000),
  returns: zero,
  startValues: { stocks: egp(10_000), gold: egp(5_000), clouds: egp(5_000), cash: egp(20_000) },
  liabilities: egp(10_000),
  years: 3,
  inflation: null,
  goals: [],
  ...over,
});

const nw = (r: ReturnType<typeof projectScenario>) => r.rows.map((x) => x.netWorth);

describe("with 0% everywhere it is plain arithmetic", () => {
  const r = projectScenario(base());

  it("net worth (assets 40,000 - owed 10,000) + 12 x savings per year", () => {
    expect(nw(r)).toEqual([egp(30_000), egp(126_000), egp(222_000), egp(318_000)]);
    expect(r.rows.map((x) => x.year)).toEqual([0, 1, 2, 3]);
  });

  it("5,000 is invested by today's mix of stocks, gold and clouds (50/25/25) and the other 3,000 stays in cash", () => {
    expect(r.rows[1].byClass).toEqual({
      stocks: egp(10_000 + 12 * 2_500),
      gold: egp(5_000 + 12 * 1_250),
      clouds: egp(5_000 + 12 * 1_250),
      cash: egp(20_000 + 12 * 3_000),
    });
    expect(r.rows[1].investments).toBe(egp(20_000 + 12 * 5_000));
  });

  it("the classes always add up to net worth plus the flat liabilities", () => {
    for (const row of r.rows) expect(Object.values(row.byClass).reduce((s, v) => s + v, 0) - egp(10_000)).toBe(row.netWorth);
  });

  it("states the assumptions used", () => {
    expect(r.used).toMatchObject({ monthlySavings: egp(8_000), monthlyInvestment: egp(5_000), incomeGrowth: 0, inflation: null });
    expect(r.used.investSplit).toEqual({ stocks: 0.5, gold: 0.25, clouds: 0.25 });
  });
});

describe("compound growth matches projection.ts", () => {
  it("fixture 1: 100,000 + 30,000/month at 20% for 60 months = 3,165,301", () => {
    const r = projectScenario(
      base({
        monthlyIncome: egp(30_000),
        monthlySpending: 0,
        monthlyInvestment: egp(30_000),
        startValues: { stocks: egp(100_000), gold: 0, clouds: 0, cash: 0 },
        returns: { ...zero, stocks: 0.2 },
        liabilities: 0,
        years: 5,
      }),
    );
    const exact = futureValue(egp(100_000), egp(30_000), 0.2, 60); // 316,530,125 piasters
    expect(exact).toBe(316_530_125);
    expect(Math.abs(r.rows[5].byClass.stocks - exact)).toBeLessThanOrEqual(1);
    expect(r.rows[5].netWorth).toBe(r.rows[5].byClass.stocks);
    expect(Math.abs(r.rows[1].byClass.stocks - futureValue(egp(100_000), egp(30_000), 0.2, 12))).toBeLessThanOrEqual(1);
  });

  it("each class grows at its own rate", () => {
    const r = projectScenario(
      base({
        monthlyIncome: 0,
        monthlySpending: 0,
        monthlyInvestment: 0,
        startValues: { stocks: egp(100_000), gold: egp(100_000), clouds: egp(100_000), cash: egp(100_000) },
        returns: { stocks: 0.1, gold: 0.2, clouds: 0.3, cash: 0 },
        liabilities: 0,
        years: 2,
      }),
    );
    expect(r.rows[2].byClass.stocks).toBeCloseTo(egp(121_000), -1);
    expect(r.rows[2].byClass.gold).toBeCloseTo(egp(144_000), -1);
    expect(r.rows[2].byClass.clouds).toBeCloseTo(egp(169_000), -1);
    expect(r.rows[2].byClass.cash).toBe(egp(100_000));
  });
});

describe("income and savings", () => {
  it("derived savings follow income growth once a year; spending stays flat", () => {
    const r = projectScenario(base({ incomeGrowth: 0.1, monthlyInvestment: 0 }));
    // year 1: 20,000 - 12,000; year 2: 22,000 - 12,000; year 3: 24,200 - 12,000
    expect(nw(r).map((v, i, a) => (i === 0 ? v : v - a[i - 1]))).toEqual([egp(30_000), egp(96_000), egp(120_000), egp(146_400)]);
  });

  it("a typed savings figure is held flat even with income growth", () => {
    const r = projectScenario(base({ incomeGrowth: 0.1, monthlySavings: egp(1_000), monthlyInvestment: 0 }));
    expect(nw(r)).toEqual([egp(30_000), egp(42_000), egp(54_000), egp(66_000)]);
    expect(r.used.monthlySavings).toBe(egp(1_000));
  });

  it("investing more than is saved is capped at the savings; the cash share is then 0", () => {
    const r = projectScenario(base({ monthlyInvestment: egp(50_000), years: 1 }));
    expect(r.used.monthlyInvestment).toBe(egp(8_000));
    expect(r.rows[1].byClass.cash).toBe(egp(20_000));
  });

  it("spending above income draws cash down and invests nothing", () => {
    const r = projectScenario(base({ monthlySpending: egp(22_000), years: 1 }));
    expect(r.rows[1].byClass.cash).toBe(egp(20_000 - 24_000));
    expect(r.rows[1].investments).toBe(egp(20_000));
    expect(r.used.monthlyInvestment).toBe(0);
  });

  it("with nothing held, the invested part goes to stocks", () => {
    const r = projectScenario(base({ startValues: { stocks: 0, gold: 0, clouds: 0, cash: 0 }, years: 1 }));
    expect(r.rows[1].byClass.stocks).toBe(egp(60_000));
  });
});

describe("zero years and validation", () => {
  it("0 years returns today's figures", () => {
    const r = projectScenario(base({ years: 0, inflation: 0.1 }));
    expect(r.rows).toEqual([
      {
        year: 0,
        netWorth: egp(30_000),
        byClass: { stocks: egp(10_000), gold: egp(5_000), clouds: egp(5_000), cash: egp(20_000) },
        investments: egp(20_000),
        realNetWorth: egp(30_000),
      },
    ]);
  });

  it("is deterministic", () => {
    const input = base({ years: 7, incomeGrowth: 0.07, returns: { stocks: 0.15, gold: 0.08, clouds: 0.2, cash: 0.05 }, inflation: 0.12 });
    expect(projectScenario(input)).toEqual(projectScenario(input));
  });

  it.each([
    ["negative years", { years: -1 }],
    ["fractional years", { years: 1.5 }],
    ["more than 100 years", { years: 101 }],
    ["a return of -100%", { returns: { ...zero, stocks: -1 } }],
    ["fractional piasters", { monthlyIncome: 1.5 }],
    ["inflation of -100%", { inflation: -1 }],
  ] as [string, Partial<ScenarioInput>][])("refuses %s", (_name, over) => {
    expect(() => projectScenario(base(over))).toThrow(RangeError);
  });
});

describe("real terms", () => {
  const noContributions = base({
    monthlyIncome: 0,
    monthlySpending: 0,
    monthlyInvestment: 0,
    startValues: { stocks: egp(100_000), gold: 0, clouds: 0, cash: 0 },
    returns: { ...zero, stocks: 0.2 },
    liabilities: 0,
    years: 5,
    inflation: 0.1,
  });

  it("is absent without inflation", () => {
    expect(projectScenario({ ...noContributions, inflation: null }).rows.every((r) => !("realNetWorth" in r))).toBe(true);
  });

  it("growing at 20% with 10% inflation equals growing at the real rate (1.2 / 1.1 - 1)", () => {
    const r = projectScenario(noContributions);
    const real = realRate(0.2, 0.1);
    for (const row of r.rows) expect(Math.abs(row.realNetWorth! - Math.round(egp(100_000) * (1 + real) ** row.year))).toBeLessThanOrEqual(1);
    expect(r.rows[5].netWorth).toBeGreaterThan(r.rows[5].realNetWorth!);
  });

  it("a return equal to inflation leaves the real figure unchanged", () => {
    const r = projectScenario({ ...noContributions, returns: { ...zero, stocks: 0.1 } });
    for (const row of r.rows) expect(Math.abs(row.realNetWorth! - egp(100_000))).toBeLessThanOrEqual(1);
  });

  it("zero inflation: real equals nominal", () => {
    const r = projectScenario({ ...noContributions, inflation: 0 });
    for (const row of r.rows) expect(row.realNetWorth).toBe(row.netWorth);
  });
});

describe("goals under the scenario", () => {
  const goal = (over: Partial<ScenarioGoal> = {}): ScenarioGoal => ({
    id: "car",
    name: "Car",
    target: egp(12_000),
    targetDate: "2026-12-31",
    current: 0,
    plannedMonthly: egp(1_000),
    sources: [{ class: "cash", value: egp(1) }],
    returnOverride: null,
    contributedThisMonth: false,
    ...over,
  });
  const run = (goals: ScenarioGoal[], over: Partial<ScenarioInput> = {}) => projectScenario(base({ goals, years: 1, ...over })).goals;

  it("reuses goalProjection: required monthly, months late and completion date", () => {
    const [g] = run([goal()]);
    expect(g).toMatchObject({ monthsRemaining: 10, requiredMonthly: egp(1_200), onTrack: false, monthsLate: 2, annualReturn: 0 });
    // 12 contributions of 1,000 from the end of March: the 12th lands on 28 Feb 2027
    expect(g.completionDate).toBe("2027-02-28");
  });

  it("agrees with goalProjection at the scenario's blended rate", () => {
    const [g] = run([goal({ target: egp(500_000), current: egp(50_000), plannedMonthly: egp(10_000), sources: [{ class: "stocks", value: egp(30_000) }, { class: "cash", value: egp(20_000) }], targetDate: "2030-12-31" })], {
      returns: { ...zero, stocks: 0.2, cash: 0.1 },
    });
    expect(g.annualReturn).toBeCloseTo(0.16, 12);
    const direct = goalProjection({ target: egp(500_000), current: egp(50_000), plannedMonthly: egp(10_000), annualReturn: g.annualReturn, today: "2026-03-10", targetDate: "2030-12-31", startDay: 1, contributedThisMonth: false });
    expect([g.projectedAtTarget, g.monthsLate, g.requiredMonthly]).toEqual([direct.projectedAtTarget, direct.monthsLate, direct.required]);
  });

  it("changing a class return moves a goal backed by it", () => {
    const stocksGoal = goal({ target: egp(500_000), current: egp(50_000), plannedMonthly: egp(5_000), sources: [{ class: "stocks", value: egp(50_000) }], targetDate: "2030-12-31" });
    const low = run([stocksGoal], { returns: { ...zero, stocks: 0.05 } })[0];
    const high = run([stocksGoal], { returns: { ...zero, stocks: 0.25 } })[0];
    expect(high.projectedAtTarget).toBeGreaterThan(low.projectedAtTarget);
    expect(high.requiredMonthly!).toBeLessThan(low.requiredMonthly!);
  });

  it("an override return wins over the classes", () => {
    expect(run([goal({ returnOverride: 0.07 })])[0].annualReturn).toBe(0.07);
  });

  it("already funded: completes today; a contribution already made this month starts next month", () => {
    expect(run([goal({ current: egp(12_000) })])[0]).toMatchObject({ completionDate: "2026-03-10", onTrack: true });
    expect(run([goal({ contributedThisMonth: true })])[0].completionDate).toBe("2027-03-31");
  });

  it("never reached at the planned amount: no date", () => {
    expect(run([goal({ plannedMonthly: 0 })])[0].completionDate).toBeNull();
  });

  it("a passed target date has no required monthly figure", () => {
    expect(run([goal({ targetDate: "2026-02-28" })])[0].requiredMonthly).toBeNull();
  });

  it("inflation adds the adjusted view, separately from the nominal one", () => {
    const g = goal({ target: egp(600_000), current: egp(50_000), plannedMonthly: egp(5_000), targetDate: "2030-12-31" });
    const without = run([g])[0];
    expect(without.adjusted).toBeUndefined();
    const withInflation = run([g], { inflation: 0.12 })[0];
    const years = withInflation.monthsRemaining / 12;
    expect(withInflation.adjusted!.target).toBe(inflationAdjustedTarget(egp(600_000), 0.12, years));
    expect(withInflation.adjusted!.target).toBeGreaterThan(egp(600_000));
    // the nominal figures do not move when inflation is switched on
    expect({ ...withInflation, adjusted: undefined }).toEqual({ ...without, adjusted: undefined });
    expect(withInflation.adjusted!.requiredMonthly!).toBeGreaterThan(withInflation.requiredMonthly!);
  });

  it("flags planned goal contributions larger than the monthly savings", () => {
    const r = projectScenario(base({ goals: [goal({ plannedMonthly: egp(9_000) })], years: 1 }));
    expect(r.goalsExceedSavings).toBe(true);
    expect(projectScenario(base({ goals: [goal({ plannedMonthly: egp(8_000) })], years: 1 })).goalsExceedSavings).toBe(false);
  });
});
