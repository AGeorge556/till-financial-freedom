import { describe, expect, it } from "vitest";
import { egpToPiasters as egp } from "./money";
import { buildReminders, type ReminderInput, type ReminderKind, type ReminderSwitches } from "./reminders";

const MONTH = { start: "2026-04-01", end: "2026-04-30" };
const ALL_ON: ReminderSwitches = { review: true, recurring: true, stale: true, goal: true, budget: true, savings: true };
const KINDS = Object.keys(ALL_ON) as ReminderKind[];
const off = (...k: ReminderKind[]): ReminderSwitches => ({ ...ALL_ON, ...Object.fromEntries(k.map((x) => [x, false])) });

const nothing = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  month: MONTH,
  previousMonthHasData: false,
  pendingRecurring: { count: 0, expense: 0, income: 0 },
  staleCount: 0,
  goals: [],
  budgets: [],
  lastMonthSavings: null,
  ...over,
});

const everything = (): ReminderInput =>
  nothing({
    previousMonthHasData: true,
    pendingRecurring: { count: 2, expense: egp(700), income: 0 },
    staleCount: 3,
    goals: [{ id: "car", name: "Car", planned: egp(2_000), actual: egp(500) }],
    budgets: [{ id: "food", name: "Food", status: { level: "over", spent: egp(1_300), budget: egp(1_000), percentUsed: 1.3 } }],
    lastMonthSavings: { saved: egp(1_000), target: egp(3_000) },
  });

const run = (input: ReminderInput, today: string, switches = ALL_ON) => buildReminders(input, switches, today);

describe("buildReminders", () => {
  it("nothing to remind about gives nothing", () => {
    expect(run(nothing(), "2026-04-25")).toEqual([]);
  });

  it("every kind fires on a day when all conditions hold, each with a link", () => {
    const r = run(everything(), "2026-04-03");
    // the goal reminder waits for day 21
    expect(r.map((x) => x.kind)).toEqual(["review", "recurring", "stale", "budget", "savings"]);
    const late = run(everything(), "2026-04-25");
    expect(late.map((x) => x.kind)).toEqual(["recurring", "stale", "goal", "budget", "savings"]);
    for (const x of [...r, ...late]) expect(x.href).toMatch(/^\//);
  });

  it.each(KINDS)("the %s switch turns exactly that kind off", (kind) => {
    // day 21 is not in the review window, so check each kind on a day where it can fire
    const today = kind === "review" ? "2026-04-03" : "2026-04-25";
    const on = run(everything(), today);
    expect(on.some((x) => x.kind === kind)).toBe(true);
    const without = run(everything(), today, off(kind));
    expect(without.some((x) => x.kind === kind)).toBe(false);
    expect(without).toHaveLength(on.length - on.filter((x) => x.kind === kind).length);
  });

  it("all switches off: nothing", () => {
    expect(run(everything(), "2026-04-03", off(...KINDS))).toEqual([]);
  });
});

describe("date boundaries", () => {
  it.each([
    ["1 Apr (day 1)", "2026-04-01", true],
    ["7 Apr (day 7)", "2026-04-07", true],
    ["8 Apr (day 8)", "2026-04-08", false],
    ["30 Apr", "2026-04-30", false],
  ])("review on %s: %s", (_name, today, shown) => {
    expect(run(nothing({ previousMonthHasData: true }), today).some((x) => x.kind === "review")).toBe(shown);
  });

  it("review needs a finished month with data", () => {
    expect(run(nothing({ previousMonthHasData: false }), "2026-04-02")).toEqual([]);
  });

  it("review window follows the financial month, not the calendar month", () => {
    const month = { start: "2026-04-25", end: "2026-05-24" };
    expect(run(nothing({ month, previousMonthHasData: true }), "2026-05-01").map((x) => x.kind)).toEqual(["review"]); // day 7
    expect(run(nothing({ month, previousMonthHasData: true }), "2026-05-02")).toEqual([]); // day 8
  });

  it.each([
    ["20 Apr (day 20)", "2026-04-20", false],
    ["21 Apr (day 21)", "2026-04-21", true],
    ["30 Apr", "2026-04-30", true],
  ])("goal contribution due on %s: %s", (_name, today, shown) => {
    const input = nothing({ goals: [{ id: "g", name: "Car", planned: egp(1_000), actual: egp(999) }] });
    expect(run(input, today).some((x) => x.kind === "goal")).toBe(shown);
  });

  it("goal reminder needs planned strictly above actual", () => {
    const g = (planned: number, actual: number) => nothing({ goals: [{ id: "g", name: "Car", planned: egp(planned), actual: egp(actual) }] });
    expect(run(g(1_000, 1_000), "2026-04-25")).toEqual([]);
    expect(run(g(1_000, 1_500), "2026-04-25")).toEqual([]);
    expect(run(g(1_000, 0), "2026-04-25")).toHaveLength(1);
  });

  it("one goal reminder per goal that is behind, linking to that goal", () => {
    const input = nothing({
      goals: [
        { id: "a", name: "A", planned: 200, actual: 0 },
        { id: "b", name: "B", planned: 200, actual: 200 },
        { id: "c", name: "C", planned: 200, actual: 100 },
      ],
    });
    expect(run(input, "2026-04-25").map((x) => [x.id, x.href])).toEqual([["goal:a", "/goals/a"], ["goal:c", "/goals/c"]]);
  });
});

describe("other conditions", () => {
  it("recurring: only with waiting items; singular and plural", () => {
    expect(run(nothing(), "2026-04-25")).toEqual([]);
    expect(run(nothing({ pendingRecurring: { count: 1, expense: egp(5), income: 0 } }), "2026-04-25")[0].text[0]).toEqual({ text: "1 recurring item is waiting for you to confirm" });
    expect(run(nothing({ pendingRecurring: { count: 4, expense: egp(5), income: 0 } }), "2026-04-25")[0].text[0]).toEqual({ text: "4 recurring items are waiting for you to confirm" });
  });

  it("recurring: expense and income are separate amounts, never one total", () => {
    const [r] = run(nothing({ pendingRecurring: { count: 2, expense: egp(5), income: egp(7) } }), "2026-04-25");
    expect(r.text.filter((p) => "amount" in p)).toEqual([{ amount: egp(5) }, { amount: egp(7) }]);
  });

  it("stale: only with stale values", () => {
    expect(run(nothing({ staleCount: 0 }), "2026-04-25")).toEqual([]);
    expect(run(nothing({ staleCount: 1 }), "2026-04-25")[0]).toMatchObject({ kind: "stale", href: "/investments" });
  });

  it.each([
    ["ok", false],
    ["warn", true],
    ["alert", true],
    ["over", true],
  ] as const)("budget at level %s: %s", (level, shown) => {
    const input = nothing({ budgets: [{ id: "f", name: "Food", status: { level, spent: egp(900), budget: egp(1_000), percentUsed: 0.9 } }] });
    expect(run(input, "2026-04-25")).toHaveLength(shown ? 1 : 0);
  });

  it("budget wording: approaching vs over", () => {
    const status = (level: "warn" | "over", spent: number) => ({ level, spent: egp(spent), budget: egp(1_000), percentUsed: spent / 1_000 });
    const text = (level: "warn" | "over", spent: number) => JSON.stringify(run(nothing({ budgets: [{ id: "f", name: "Food", status: status(level, spent) }] }), "2026-04-25")[0].text);
    expect(text("warn", 850)).toMatch(/85% of the budget is used/);
    expect(text("warn", 850)).not.toMatch(/over budget/);
    expect(text("over", 1_200)).toMatch(/over budget this month/);
  });

  it.each([
    ["saved 1 piaster under target", egp(3_000) - 1, true],
    ["saved exactly the target", egp(3_000), false],
    ["saved more", egp(4_000), false],
    ["saved nothing", 0, true],
    ["overspent", -egp(10), true],
  ])("savings: %s -> %s", (_name, saved, shown) => {
    expect(run(nothing({ lastMonthSavings: { saved, target: egp(3_000) } }), "2026-04-25")).toHaveLength(shown ? 1 : 0);
  });

  it("savings: no target or no full month means no reminder", () => {
    expect(run(nothing({ lastMonthSavings: null }), "2026-04-25")).toEqual([]);
    expect(run(nothing({ lastMonthSavings: { saved: 0, target: 0 } }), "2026-04-25")).toEqual([]);
  });

  it("amounts are parts, never plain text", () => {
    for (const r of run(everything(), "2026-04-25")) {
      for (const p of r.text) if ("text" in p) expect(p.text).not.toMatch(/EGP|\d,\d{3}|\d{4,}/);
    }
  });
});
