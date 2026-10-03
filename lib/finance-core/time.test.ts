import { describe, expect, it } from "vitest";
import { cairoToday, CONTRIBUTION_TIMING, financialMonth, monthsRemaining } from "./time";

describe("cairoToday", () => {
  it.each([
    ["2026-10-03T20:59:59Z", "2026-10-03"], // 23:59:59 in Cairo (UTC+3, summer time)
    ["2026-10-03T21:00:00Z", "2026-10-04"], // midnight in Cairo
    ["2026-01-15T21:59:59Z", "2026-01-15"], // 23:59:59 in Cairo (UTC+2, winter time)
    ["2026-01-15T22:00:00Z", "2026-01-16"],
    ["2026-12-31T22:00:00Z", "2027-01-01"],
  ])("%s -> %s", (iso, expected) => {
    expect(cairoToday(new Date(iso))).toBe(expected);
  });

  it("defaults to now", () => {
    expect(cairoToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("financialMonth", () => {
  it.each([
    ["2026-10-03", 1, "2026-10-01", "2026-10-31"],
    ["2026-02-10", 1, "2026-02-01", "2026-02-28"],
    ["2028-02-10", 1, "2028-02-01", "2028-02-29"], // leap year
    ["2026-10-03", 25, "2026-09-25", "2026-10-24"],
    ["2026-10-25", 25, "2026-10-25", "2026-11-24"],
    ["2026-10-24", 25, "2026-09-25", "2026-10-24"],
    ["2026-01-10", 15, "2025-12-15", "2026-01-14"], // year boundary
    ["2026-12-20", 15, "2026-12-15", "2027-01-14"],
    ["2026-03-05", 28, "2026-02-28", "2026-03-27"],
  ])("%s, starts day %d -> %s..%s", (date, startDay, start, end) => {
    expect(financialMonth(date, startDay)).toEqual({ start, end });
  });

  it.each([0, 29, 1.5, NaN])("rejects start day %d", (startDay) => {
    expect(() => financialMonth("2026-10-03", startDay)).toThrow(RangeError);
  });

  it("rejects malformed dates", () => {
    expect(() => financialMonth("03/10/2026", 1)).toThrow(RangeError);
  });
});

describe("monthsRemaining", () => {
  it("contributes at the end of the month", () => {
    expect(CONTRIBUTION_TIMING).toBe("end-of-month");
  });

  it.each([
    ["2030-12-01", 50], // Oct 2026 .. Nov 2030
    ["2030-12-31", 51], // Oct 2026 .. Dec 2030
    ["2026-10-31", 1], // this month's end is the target date
    ["2026-10-30", 0], // target before this month's end
    ["2026-10-03", 0],
    ["2026-01-01", 0], // past
    ["2027-10-31", 13],
  ])("today 2026-10-03, not contributed, target %s -> %d", (target, expected) => {
    expect(monthsRemaining("2026-10-03", target, 1, false)).toBe(expected);
  });

  it("skips this month once contributed", () => {
    expect(monthsRemaining("2026-10-03", "2030-12-01", 1, true)).toBe(49);
    expect(monthsRemaining("2026-10-03", "2030-12-31", 1, true)).toBe(50);
    expect(monthsRemaining("2026-10-03", "2026-10-31", 1, true)).toBe(0);
  });

  it("works with a custom month start day", () => {
    // Periods end on the 24th: Oct 24 2026 is the first end date, Dec 24 2026 the third.
    expect(monthsRemaining("2026-10-03", "2026-12-24", 25, false)).toBe(3);
    expect(monthsRemaining("2026-10-03", "2026-12-23", 25, false)).toBe(2);
    // On the 25th a new period has begun, so Oct 24 is gone.
    expect(monthsRemaining("2026-10-25", "2026-12-24", 25, false)).toBe(2);
    expect(monthsRemaining("2026-10-25", "2026-12-24", 25, true)).toBe(1);
  });
});
