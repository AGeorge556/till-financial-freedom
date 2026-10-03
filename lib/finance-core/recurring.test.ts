import { describe, expect, it } from "vitest";
import { addDays, dateOn, daysBetween, dueDates, missingOccurrences, upcomingInMonth, type RecurringTemplate } from "./recurring";

const t = (over: Partial<RecurringTemplate> = {}): RecurringTemplate => ({
  id: "t1",
  type: "EXPENSE",
  amount: 100_000,
  categoryId: "rent",
  accountId: "bank",
  frequency: "monthly",
  startDate: "2026-01-10",
  endDate: null,
  active: true,
  ...over,
});

describe("date helpers", () => {
  it.each([
    ["2026-02-28", 1, "2026-03-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-01", -1, "2026-02-28"],
  ])("addDays(%s, %i) = %s", (d, n, expected) => {
    expect(addDays(d, n)).toBe(expected);
  });

  it("daysBetween is signed", () => {
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2026-04-01", "2026-03-01")).toBe(-31);
    expect(daysBetween("2026-04-20", "2026-04-30")).toBe(10);
  });

  it.each([
    [2026, 2, 31, "2026-02-28"],
    [2028, 2, 31, "2028-02-29"],
    [2026, 4, 31, "2026-04-30"],
    [2026, 1, 31, "2026-01-31"],
  ])("dateOn(%i, %i, %i) = %s", (y, m, d, expected) => {
    expect(dateOn(y, m, d)).toBe(expected);
  });

  it("rejects a malformed date", () => {
    expect(() => daysBetween("2026-3-1", "2026-03-02")).toThrow(RangeError);
  });
});

describe("dueDates", () => {
  it.each([
    ["weekly", "weekly", "2026-01-05", "2026-02-02", ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"]],
    ["monthly day 31 clamps in short months and does not drift", "monthly", "2026-01-31", "2026-05-31", ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]],
    ["monthly day 31 in a leap February", "monthly", "2028-01-31", "2028-03-01", ["2028-01-31", "2028-02-29"]],
    ["monthly across a year end", "monthly", "2025-11-15", "2026-02-15", ["2025-11-15", "2025-12-15", "2026-01-15", "2026-02-15"]],
    ["yearly 29 Feb", "yearly", "2024-02-29", "2029-03-01", ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29", "2029-02-28"]],
    ["yearly stops before the next anniversary", "yearly", "2024-06-15", "2026-06-14", ["2024-06-15", "2025-06-15"]],
  ] as const)("%s", (_name, frequency, start, upTo, expected) => {
    expect(dueDates(t({ frequency, startDate: start }), upTo)).toEqual(expected);
  });

  it("is inclusive of the start date and empty before it", () => {
    expect(dueDates(t({ startDate: "2026-03-10" }), "2026-03-10")).toEqual(["2026-03-10"]);
    expect(dueDates(t({ startDate: "2026-03-10" }), "2026-03-09")).toEqual([]);
  });

  it("stops at the end date, inclusive", () => {
    expect(dueDates(t({ endDate: "2026-03-10" }), "2026-12-31")).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
    expect(dueDates(t({ endDate: "2026-03-09" }), "2026-12-31")).toEqual(["2026-01-10", "2026-02-10"]);
  });

  it("an inactive template has no due dates", () => {
    expect(dueDates(t({ active: false }), "2026-12-31")).toEqual([]);
  });
});

describe("missingOccurrences (R3)", () => {
  it("after a 4-month gap creates each occurrence once", () => {
    const template = t({ startDate: "2026-01-10" });
    const first = missingOccurrences(template, ["2026-01-10"], "2026-05-20");
    expect(first).toEqual(["2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10"]);
    // the generator wrote them; loading again creates nothing
    expect(missingOccurrences(template, ["2026-01-10", ...first], "2026-05-20")).toEqual([]);
  });

  it("a skipped (void) occurrence is among the existing dates, so it is not regenerated", () => {
    expect(missingOccurrences(t(), ["2026-01-10", "2026-02-10"], "2026-03-10")).toEqual(["2026-03-10"]);
  });

  it("a template starting today gets today's row; one starting tomorrow gets none", () => {
    expect(missingOccurrences(t({ startDate: "2026-03-10" }), [], "2026-03-10")).toEqual(["2026-03-10"]);
    expect(missingOccurrences(t({ startDate: "2026-03-11" }), [], "2026-03-10")).toEqual([]);
  });

  it("ended and inactive templates generate nothing more", () => {
    expect(missingOccurrences(t({ endDate: "2026-02-15" }), ["2026-01-10", "2026-02-10"], "2026-06-01")).toEqual([]);
    expect(missingOccurrences(t({ active: false }), [], "2026-06-01")).toEqual([]);
  });
});

describe("upcomingInMonth (B3)", () => {
  const range = { start: "2026-03-01", end: "2026-03-31" };
  const templates = [
    t({ id: "rent", startDate: "2025-06-01", amount: 400_000 }),
    t({ id: "internet", startDate: "2025-06-20", amount: 50_000 }),
    t({ id: "gym", startDate: "2025-06-25", amount: 30_000 }),
    t({ id: "skipped", startDate: "2025-06-28", amount: 20_000 }),
    t({ id: "salary", type: "INCOME", startDate: "2025-06-27", amount: 3_000_000 }),
    t({ id: "off", startDate: "2025-06-15", active: false }),
    t({ id: "ended", startDate: "2025-06-12", endDate: "2026-02-12" }),
    t({ id: "later", startDate: "2026-04-01" }),
  ];
  const existing = [
    { templateId: "internet", dueDate: "2026-03-20", status: "pending" as const },
    { templateId: "gym", dueDate: "2026-03-25", status: "posted" as const },
    { templateId: "skipped", dueDate: "2026-03-28", status: "void" as const },
  ];

  it("lists pending and not-yet-generated occurrences only", () => {
    const items = upcomingInMonth(templates, existing, range, "2026-03-10");
    expect(items.map((i) => [i.templateId, i.dueDate, i.pending])).toEqual([
      ["rent", "2026-03-01", false],
      ["internet", "2026-03-20", true],
      ["salary", "2026-03-27", false],
    ]);
    expect(items.find((i) => i.templateId === "rent")).toMatchObject({ type: "EXPENSE", amount: 400_000, categoryId: "rent", accountId: "bank" });
  });

  it("ignores a pending row that belongs to another month", () => {
    const stale = [{ templateId: "rent", dueDate: "2026-02-01", status: "pending" as const }];
    expect(upcomingInMonth([templates[0]], stale, range, "2026-03-10").map((i) => i.dueDate)).toEqual(["2026-03-01"]);
  });

  it("a month that is already over has nothing upcoming", () => {
    expect(upcomingInMonth(templates, existing, range, "2026-04-02")).toEqual([]);
    expect(upcomingInMonth(templates, existing, range, "2026-03-31").length).toBeGreaterThan(0);
  });
});
