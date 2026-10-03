import { describe, expect, it } from "vitest";
import { budgetStatus, DEFAULT_BUDGET_ALERT_AT, DEFAULT_BUDGET_WARN_AT, type BudgetTx } from "./budget";
import { egpToPiasters as egp } from "./money";

const MARCH = { start: "2026-03-01", end: "2026-03-31" }; // 31 days

const exp = (date: string, amountEgp: number, over: Partial<BudgetTx> = {}): BudgetTx => ({
  type: "EXPENSE",
  date,
  amount: egp(amountEgp),
  fromAccountId: "bank",
  status: "posted",
  fixed: false,
  ...over,
});

const status = (over: Partial<Parameters<typeof budgetStatus>[0]> = {}) =>
  budgetStatus({
    budget: egp(10_000),
    expenses: [],
    upcomingFixed: 0,
    monthRange: MARCH,
    today: "2026-03-10",
    warnAt: DEFAULT_BUDGET_WARN_AT,
    alertAt: DEFAULT_BUDGET_ALERT_AT,
    ...over,
  });

describe("projection (B3)", () => {
  it("never extrapolates a fixed bill, but extrapolates variable spending per day", () => {
    const s = status({ expenses: [exp("2026-03-01", 4_000, { fixed: true }), exp("2026-03-05", 1_000)] });
    // 10 days elapsed, 21 left: 4,000 + 1,000 + 1,000 / 10 x 21
    expect(s.spent).toBe(egp(5_000));
    expect(s.projected).toBe(egp(7_100));
  });

  it("treating the same rent as variable would project far higher", () => {
    const s = status({ expenses: [exp("2026-03-01", 4_000), exp("2026-03-05", 1_000)] });
    expect(s.projected).toBe(egp(15_500));
  });

  it("adds the recurring items still due this month", () => {
    const s = status({ expenses: [exp("2026-03-05", 1_000)], upcomingFixed: egp(2_000) });
    expect(s.projected).toBe(egp(1_000 + 2_000 + 2_100));
  });

  it.each([
    ["first day: one day of data, 30 left", "2026-03-01", 0, egp(300) + egp(300) * 30],
    ["last day: nothing left to extrapolate, upcoming still counts", "2026-03-31", egp(1_000), egp(300) + egp(1_000)],
    ["month over: the projection is the actual, upcoming ignored", "2026-04-05", egp(1_000), egp(300)],
    ["month not started: only the known fixed items", "2026-02-20", egp(1_000), egp(300) + egp(1_000)],
  ])("%s", (_name, today, upcomingFixed, projected) => {
    expect(status({ today, upcomingFixed, expenses: [exp("2026-03-01", 300)] }).projected).toBe(projected);
  });

  it("rounds the projection to whole piasters", () => {
    // 100 piasters over 3 days, 28 left -> 933.33...
    const s = status({ budget: 10_000_000, today: "2026-03-03", expenses: [{ ...exp("2026-03-01", 0), amount: 100 }] });
    expect(s.projected).toBe(100 + 933);
    expect(Number.isInteger(s.projected)).toBe(true);
  });
});

describe("what counts as spent", () => {
  it("only posted EXPENSE rows dated inside the month", () => {
    const s = status({
      expenses: [
        exp("2026-03-02", 100),
        exp("2026-03-03", 900, { status: "pending", fixed: true }),
        exp("2026-03-03", 800, { status: "void" }),
        exp("2026-02-28", 700),
        exp("2026-04-01", 600),
        exp("2026-03-04", 500, { type: "TRANSFER", toAccountId: "savings" }),
        exp("2026-03-04", 400, { type: "INVESTMENT_PURCHASE" }),
      ],
    });
    expect(s.spent).toBe(egp(100));
  });
});

describe("warnings (B4)", () => {
  // Budget 10,000 EGP: 80% is 800,000 piasters and 100% is 1,000,000.
  it.each([
    [799_999, "ok"],
    [800_000, "warn"],
    [999_999, "warn"],
    [1_000_000, "over"],
    [1_000_001, "over"],
  ])("spent %i piasters -> %s", (spent, level) => {
    const s = status({ expenses: [{ ...exp("2026-03-10", 0), amount: spent }], today: "2026-03-31" });
    expect(s.level).toBe(level);
  });

  it("remaining goes negative and percent passes 1 once exceeded", () => {
    const s = status({ expenses: [exp("2026-03-10", 12_500)] });
    expect([s.remaining, s.percentUsed]).toEqual([egp(-2_500), 1.25]);
  });

  it("flags a projection over the budget while spending is still under it", () => {
    const s = status({ expenses: [exp("2026-03-05", 4_000)] });
    expect(s.level).toBe("ok");
    expect(s.spent).toBeLessThan(s.budget);
    expect(s.projected).toBe(egp(4_000 + 8_400));
    expect(s.projectedOver).toBe(true);
  });

  it("is not projected over when the pace fits", () => {
    expect(status({ expenses: [exp("2026-03-05", 1_000)] }).projectedOver).toBe(false);
  });

  it("uses the thresholds it is given", () => {
    expect(status({ expenses: [exp("2026-03-10", 5_000)], warnAt: 0.5, alertAt: 0.6 }).level).toBe("warn");
    expect(status({ expenses: [exp("2026-03-10", 6_000)], warnAt: 0.5, alertAt: 0.6 }).level).toBe("over");
  });

  it.each([0, -1, 1.5])("refuses a budget of %s", (budget) => {
    expect(() => status({ budget })).toThrow(RangeError);
  });
});
