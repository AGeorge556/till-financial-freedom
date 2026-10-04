import { describe, expect, it } from "vitest";
import { fullMonths, type CategorizedTx } from "./analytics";
import { buildInsights, topN, type Insight, type InsightInput, type InsightKind } from "./insights";
import { egpToPiasters as egp } from "./money";
import { mix } from "./portfolioMix";

const TODAY = "2026-04-15"; // day 15 of April; earlier full months: Jan, Feb, Mar
const CURRENT = { start: "2026-04-01", end: "2026-04-30" };
const earlier = (n: number) => fullMonths("2026-01-01", TODAY, 1, 3).slice(3 - n);

const spend = (date: string, amountEgp: number, categoryId = "food"): CategorizedTx => ({
  type: "EXPENSE",
  date,
  amount: egp(amountEgp),
  fromAccountId: "bank",
  status: "posted",
  categoryId,
});
/** The same figure on day 5 of each of Jan, Feb and Mar. */
const usual = (amountEgp: number, categoryId = "food") => ["2026-01-05", "2026-02-05", "2026-03-05"].map((d) => spend(d, amountEgp, categoryId));

const quiet = (over: Partial<InsightInput> = {}): InsightInput => ({
  today: TODAY,
  thresholds: { percent: 0.15, amount: egp(500) },
  spending: { txs: [], currentMonth: CURRENT, earlierMonths: earlier(3), categoryNames: { food: "Food", rent: "Rent" } },
  months: [],
  savingsTarget: null,
  goals: [],
  mix: mix({ stocks: 0, gold: 0, clouds: 0, cash: 0 }),
  budgets: [],
  stale: { count: 0, value: 0 },
  pending: { count: 0, total: 0 },
  ...over,
});

const withSpending = (txs: CategorizedTx[], earlierCount = 3, over: Partial<InsightInput> = {}) =>
  quiet({ spending: { txs, currentMonth: CURRENT, earlierMonths: earlier(earlierCount), categoryNames: { food: "Food", rent: "Rent" } }, ...over });

const kinds = (i: Insight[]) => i.map((x) => x.kind);
const only = (i: Insight[], kind: InsightKind) => i.filter((x) => x.kind === kind);

describe("nothing to say", () => {
  it("an empty input gives no insights", () => {
    expect(buildInsights(quiet())).toEqual([]);
  });
});

describe("spending vs average: both bars, at the boundary", () => {
  // usual 10,000 EGP by day 15 each month; this month's spending is the other variable
  it.each([
    ["+15.0% and 1,500 EGP", 10_000, 11_500, true],
    ["+14.99% (1,499 EGP)", 10_000, 11_499, false],
    ["-15.0% is a notable drop too", 10_000, 8_500, true],
    ["-14.99%", 10_000, 8_501, false],
    ["+25% and exactly 500 EGP", 2_000, 2_500, true],
    ["+24.95% and 499 EGP", 2_000, 2_499, false],
    ["-25% and exactly 500 EGP", 2_000, 1_500, true],
    ["+100% but only 100 EGP", 100, 200, false],
    ["unchanged", 10_000, 10_000, false],
  ])("%s", (_name, usualEgp, nowEgp, fires) => {
    const found = only(buildInsights(withSpending([...usual(usualEgp), spend("2026-04-03", nowEgp)])), "spending-vs-average");
    expect(found).toHaveLength(fires ? 1 : 0);
  });

  it("uses the thresholds from settings", () => {
    const txs = [...usual(10_000), spend("2026-04-03", 10_500)];
    expect(only(buildInsights(withSpending(txs)), "spending-vs-average")).toHaveLength(0);
    const loose = withSpending(txs, 3, { thresholds: { percent: 0.05, amount: egp(100) } });
    expect(only(buildInsights(loose), "spending-vs-average")).toHaveLength(1);
    const strictAmount = withSpending([...usual(10_000), spend("2026-04-03", 12_000)], 3, { thresholds: { percent: 0.05, amount: egp(2_500) } });
    expect(only(buildInsights(strictAmount), "spending-vs-average")).toHaveLength(0);
  });

  it("compares against the same days of earlier months, never whole months", () => {
    // each earlier month also has 50,000 on the 20th, after today's day 15: it must not count
    const late = ["2026-01-20", "2026-02-20", "2026-03-20"].map((d) => spend(d, 50_000));
    const [i] = only(buildInsights(withSpending([...usual(10_000), ...late, spend("2026-04-03", 11_500)])), "spending-vs-average");
    expect(i).toBeDefined();
    expect(i.inputs.find((x) => x.label.startsWith("Usual"))?.value).toBe(egp(10_000));
    expect(i.impact).toBe(egp(1_500));
  });

  it("is a data object: severity, impact, sentence parts, inputs and a formula", () => {
    const [i] = only(buildInsights(withSpending([...usual(10_000), spend("2026-04-03", 11_500)])), "spending-vs-average");
    expect(i).toMatchObject({ id: "spending-vs-average", severity: "warning", impact: egp(1_500) });
    expect(i.text.filter((p) => "amount" in p).map((p) => (p as { amount: number }).amount)).toEqual([egp(11_500), egp(1_500), egp(10_000)]);
    expect(i.inputs.map((x) => x.value)).toEqual(expect.arrayContaining([egp(11_500), egp(10_000), egp(1_500), 0.15]));
    expect(i.formula).toMatch(/same days/);
    expect(buildInsights(withSpending([...usual(10_000), spend("2026-04-03", 8_500)]))[0].severity).toBe("good");
  });

  it("an increase from a zero baseline counts as over the percent bar, and still needs the amount", () => {
    expect(only(buildInsights(withSpending([spend("2026-04-03", 500)])), "spending-vs-average")).toHaveLength(1);
    expect(only(buildInsights(withSpending([spend("2026-04-03", 499)])), "spending-vs-average")).toHaveLength(0);
  });
});

describe("the 2-full-months rule", () => {
  const txs = [...usual(10_000), spend("2026-04-03", 12_000)];

  it.each([
    [0, false],
    [1, false],
    [2, true],
    [3, true],
  ])("with %i earlier full month(s) a comparison fires: %s", (n, fires) => {
    expect(only(buildInsights(withSpending(txs, n)), "spending-vs-average")).toHaveLength(fires ? 1 : 0);
  });

  it("savings vs target needs 2 full months", () => {
    const m = (saved: number) => ({ saved: egp(saved), cashChange: 0, invested: 0 });
    const input = (months: ReturnType<typeof m>[]) => quiet({ months, savingsTarget: egp(10_000) });
    expect(only(buildInsights(input([m(5_000)])), "savings-vs-target")).toHaveLength(0);
    expect(only(buildInsights(input([m(5_000), m(5_000)])), "savings-vs-target")).toHaveLength(1);
  });

  it("cash-up-while-investing-down needs the latest month and 2 before it", () => {
    const m = (invested: number) => ({ saved: 0, cashChange: egp(1_000), invested: egp(invested) });
    const input = (months: ReturnType<typeof m>[]) => quiet({ months });
    expect(only(buildInsights(input([m(10_000), m(2_000)])), "cash-up-investing-down")).toHaveLength(0);
    expect(only(buildInsights(input([m(10_000), m(10_000), m(2_000)])), "cash-up-investing-down")).toHaveLength(1);
  });

  it("kinds that compare nothing against history appear with no history at all", () => {
    const early = quiet({
      spending: { txs: [spend("2026-04-03", 90_000)], currentMonth: CURRENT, earlierMonths: [], categoryNames: {} },
      goals: [{ id: "g", name: "Car", onTrack: false, monthsLate: 3, gap: -egp(1_000) }],
      mix: mix({ stocks: egp(50), gold: 0, clouds: 0, cash: egp(50) }),
      budgets: [{ id: "b", name: "Food", status: { level: "warn", budget: egp(1_000), spent: egp(850), percentUsed: 0.85, projected: egp(1_200) } }],
      stale: { count: 1, value: egp(100) },
      pending: { count: 2, total: egp(300) },
    });
    expect(new Set(kinds(buildInsights(early)))).toEqual(new Set(["goal-late", "investment-share", "budget", "stale-values", "pending-recurring"]));
  });
});

describe("spending by category", () => {
  it("names the category and fires only for the one that moved", () => {
    const txs = [...usual(3_000, "food"), ...usual(8_000, "rent"), spend("2026-04-02", 3_000, "food"), spend("2026-04-02", 10_000, "rent")];
    const found = only(buildInsights(withSpending(txs)), "category-spending");
    expect(found.map((i) => i.id)).toEqual(["category-spending:rent"]);
    expect(found[0].impact).toBe(egp(2_000));
    expect(found[0].text[0]).toEqual({ text: "Spending on Rent so far this month is " });
  });

  it("applies the same two bars per category", () => {
    const txs = [...usual(3_000, "food"), spend("2026-04-02", 3_449, "food")]; // +14.97%, 449 EGP
    expect(only(buildInsights(withSpending(txs)), "category-spending")).toHaveLength(0);
  });
});

describe("savings vs target", () => {
  const two = (saved: number) => [{ saved: egp(saved), cashChange: 0, invested: 0 }, { saved: egp(saved), cashChange: 0, invested: 0 }];
  const run = (savedEgp: number, targetEgp: number | null) => only(buildInsights(quiet({ months: two(savedEgp), savingsTarget: targetEgp === null ? null : egp(targetEgp) })), "savings-vs-target");

  it.each([
    ["15% under, 1,500 EGP", 8_500, 10_000, "warning"],
    ["25% under, exactly 500 EGP", 1_500, 2_000, "warning"],
    ["well above target", 12_000, 10_000, "good"],
  ])("%s fires", (_name, saved, target, severity) => {
    const [i] = run(saved, target);
    expect(i.severity).toBe(severity);
    expect(i.impact).toBe(egp(Math.abs(saved - target)));
  });

  it.each([
    ["14.99% under", 8_501, 10_000],
    ["25% under but 499 EGP", 1_501, 2_000],
    ["exactly on target", 10_000, 10_000],
  ])("%s is silent", (_name, saved, target) => {
    expect(run(saved, target)).toHaveLength(0);
  });

  it("is silent without a target", () => {
    expect(run(0, null)).toHaveLength(0);
  });
});

describe("goals", () => {
  const goal = (over: Partial<InsightInput["goals"][number]> = {}) => ({ id: "car", name: "Car", onTrack: false, monthsLate: 3, gap: -egp(5_000), ...over });

  it("late, in months and EGP", () => {
    const [i] = buildInsights(quiet({ goals: [goal()] }));
    expect(i).toMatchObject({ kind: "goal-late", id: "goal-late:car", impact: egp(5_000), severity: "warning" });
    expect(i.text[0]).toEqual({ text: "Car is projected to be 3 months late, short by " });
  });

  it("one month late is singular", () => {
    expect(buildInsights(quiet({ goals: [goal({ monthsLate: 1 })] }))[0].text[0]).toEqual({ text: "Car is projected to be 1 month late, short by " });
  });

  it("never reached", () => {
    const [i] = buildInsights(quiet({ goals: [goal({ monthsLate: null })] }));
    expect(i.kind).toBe("goal-late");
    expect(i.inputs).toHaveLength(1);
  });

  it("early, in months", () => {
    const found = buildInsights(quiet({ goals: [goal({ onTrack: true, monthsLate: -2, gap: egp(1_200) })] }));
    expect(kinds(found).sort()).toEqual(["goal-early", "goals-on-track"]);
    expect(only(found, "goal-early")[0]).toMatchObject({ impact: egp(1_200), severity: "good" });
  });

  it("all active goals on track", () => {
    const [i] = buildInsights(quiet({ goals: [goal({ id: "a", onTrack: true, monthsLate: 0, gap: 0 }), goal({ id: "b", onTrack: true, monthsLate: 0, gap: 0 })] }));
    expect(i).toMatchObject({ kind: "goals-on-track", impact: 0 });
    expect(i.text).toEqual([{ text: "All 2 of your goals are on track." }]);
  });

  it("not claimed when any goal is behind, nor with no goals", () => {
    const found = buildInsights(quiet({ goals: [goal({ id: "a", onTrack: true, monthsLate: 0, gap: 0 }), goal({ id: "b" })] }));
    expect(kinds(found)).toEqual(["goal-late"]);
    expect(buildInsights(quiet({ goals: [] }))).toEqual([]);
  });
});

describe("allocation share", () => {
  it("investments as a share of total assets, from the mix that sums to 100%", () => {
    const [i] = buildInsights(quiet({ mix: mix({ stocks: egp(60_000), gold: egp(10_000), clouds: egp(10_000), cash: egp(20_000) }) }));
    expect(i).toMatchObject({ kind: "investment-share", impact: 0 });
    expect(i.text[0]).toEqual({ text: "Investments are 80% of your total assets (" });
  });

  it("is silent with no assets", () => {
    expect(only(buildInsights(quiet()), "investment-share")).toHaveLength(0);
  });
});

describe("cash up while investing fell", () => {
  const m = (invested: number, cashChange = egp(1_000)) => ({ saved: 0, cashChange, invested });
  const run = (months: ReturnType<typeof m>[]) => only(buildInsights(quiet({ months })), "cash-up-investing-down");

  it.each([
    ["15% drop, 1,500 EGP", 8_500, true],
    ["14.99% drop", 8_501, false],
    ["investing rose", 12_000, false],
  ])("usual 10,000, now %s", (_name, now, fires) => {
    expect(run([m(egp(10_000)), m(egp(10_000)), m(egp(10_000)), m(egp(now))])).toHaveLength(fires ? 1 : 0);
  });

  it("is silent when cash did not grow", () => {
    expect(run([m(egp(10_000)), m(egp(10_000)), m(egp(10_000)), m(egp(100), 0)])).toHaveLength(0);
  });
});

describe("budgets", () => {
  const status = (level: "ok" | "warn" | "alert" | "over", spent: number, projected = spent) => ({ level, budget: egp(1_000), spent: egp(spent), percentUsed: spent / 1_000, projected: egp(projected) });
  const run = (s: ReturnType<typeof status>) => buildInsights(quiet({ budgets: [{ id: "food", name: "Food", status: s }] }));

  it("is silent while ok", () => {
    expect(run(status("ok", 500))).toEqual([]);
  });

  it("warns and alerts without saying 'over'", () => {
    for (const lvl of ["warn", "alert"] as const) {
      const [i] = run(status(lvl, 900, 1_300));
      expect(i).toMatchObject({ kind: "budget", id: "budget:food", impact: egp(300) });
      expect(JSON.stringify(i.text)).not.toMatch(/over/i);
    }
  });

  it("says over only once money is exceeded, ranked by the amount", () => {
    const [i] = run(status("over", 1_250));
    expect(i.impact).toBe(egp(250));
    expect(i.text[0]).toEqual({ text: "You are " });
    expect(JSON.stringify(i.text)).toMatch(/over your Food budget/);
  });
});

describe("stale values and pending items", () => {
  it("count and worth, singular and plural", () => {
    const [one] = buildInsights(quiet({ stale: { count: 1, value: egp(2_000) } }));
    expect(one).toMatchObject({ kind: "stale-values", impact: egp(2_000) });
    expect(one.text[0]).toEqual({ text: "1 investment value is out of date, together worth about " });
    const [many] = buildInsights(quiet({ pending: { count: 3, total: egp(900) } }));
    expect(many).toMatchObject({ kind: "pending-recurring", impact: egp(900) });
    expect(many.text[0]).toEqual({ text: "3 recurring items are waiting for you to confirm, " });
  });
});

describe("ranking and the top 5", () => {
  const busy = () =>
    buildInsights(
      quiet({
        ...withSpending([...usual(10_000), ...usual(3_000, "rent"), spend("2026-04-03", 13_000), spend("2026-04-03", 3_000, "rent")]),
        goals: [{ id: "car", name: "Car", onTrack: false, monthsLate: 3, gap: -egp(5_000) }, { id: "home", name: "Home", onTrack: true, monthsLate: -1, gap: egp(100) }],
        mix: mix({ stocks: egp(50), gold: 0, clouds: 0, cash: egp(50) }),
        budgets: [{ id: "food", name: "Food", status: { level: "over", budget: egp(1_000), spent: egp(1_700), percentUsed: 1.7, projected: egp(2_000) } }],
        stale: { count: 2, value: egp(40_000) },
        pending: { count: 1, total: egp(250) },
      }),
    );

  it("sorts by EGP impact, largest first", () => {
    const i = busy();
    expect(i.length).toBeGreaterThan(5);
    expect(i.map((x) => x.impact)).toEqual([...i.map((x) => x.impact)].sort((a, b) => b - a));
    expect(i[0]).toMatchObject({ kind: "stale-values", impact: egp(40_000) });
  });

  it("topN keeps the 5 largest, in order", () => {
    const all = busy();
    expect(topN(all, 5).map((x) => x.id)).toEqual(all.slice(0, 5).map((x) => x.id));
    expect(topN(all, 5)).toHaveLength(5);
  });

  it("topN ranks input that was not sorted, and copes with n of 0 or more than there are", () => {
    const all = busy();
    expect(topN([...all].reverse(), 3).map((x) => x.id)).toEqual(all.slice(0, 3).map((x) => x.id));
    expect(topN(all, 0)).toEqual([]);
    expect(topN(all.slice(0, 2), 5)).toHaveLength(2);
  });

  it("ties break by id so the order is stable", () => {
    const a = buildInsights(quiet({ goals: [{ id: "b", name: "B", onTrack: true, monthsLate: -1, gap: egp(10) }, { id: "a", name: "A", onTrack: true, monthsLate: -1, gap: egp(10) }] }));
    expect(only(a, "goal-early").map((x) => x.id)).toEqual(["goal-early:a", "goal-early:b"]);
  });

  it("ids are unique", () => {
    const ids = busy().map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("privacy: an amount is never plain text", () => {
  it("no sentence part, label or formula spells out an amount", () => {
    const all = buildInsights(
      quiet({
        ...withSpending([...usual(10_000), spend("2026-04-03", 13_000)]),
        months: [{ saved: egp(100), cashChange: egp(100), invested: egp(9_000) }, { saved: egp(100), cashChange: egp(100), invested: egp(9_000) }, { saved: egp(100), cashChange: egp(100), invested: egp(9_000) }, { saved: egp(100), cashChange: egp(100), invested: egp(100) }],
        savingsTarget: egp(10_000),
        goals: [{ id: "car", name: "Car", onTrack: false, monthsLate: 3, gap: -egp(5_000) }],
        mix: mix({ stocks: egp(50), gold: 0, clouds: 0, cash: egp(50) }),
        budgets: [{ id: "f", name: "Food", status: { level: "over", budget: egp(1_000), spent: egp(1_700), percentUsed: 1.7, projected: egp(2_000) } }],
        stale: { count: 1, value: egp(100) },
        pending: { count: 1, total: egp(100) },
      }),
    );
    expect(new Set(kinds(all)).size).toBeGreaterThanOrEqual(8);
    for (const i of all) {
      const words = [...i.text.flatMap((p) => ("text" in p ? [p.text] : [])), i.formula, ...i.inputs.map((x) => x.label)];
      for (const w of words) expect(w).not.toMatch(/EGP|\d,\d{3}|\d{4,}/);
    }
  });
});
