import { describe, expect, it } from "vitest";
import { egpToPiasters as egp } from "./money";
import {
  futureValue,
  goalStatus,
  inflationAdjustedTarget,
  monthlyRate,
  monthsToTarget,
  realRate,
  requiredMonthlyContribution,
} from "./projection";

const months = (m: number) => ({ kind: "months", months: m });
const required = (monthly: number) => ({ kind: "required", monthly });

describe("monthlyRate", () => {
  it("is an effective rate, not annual / 12", () => {
    expect(monthlyRate(0.2)).toBeCloseTo(0.015309470499731193, 12);
    expect(monthlyRate(0.2)).not.toBeCloseTo(0.2 / 12, 3);
    expect((1 + monthlyRate(0.2)) ** 12).toBeCloseTo(1.2, 12);
  });

  it("handles zero and negative returns", () => {
    expect(monthlyRate(0)).toBe(0);
    expect(monthlyRate(-0.1)).toBeLessThan(0);
  });
});

describe("futureValue", () => {
  it("fixture 1: 100k + 30k/month, 20%, 60 months", () => {
    const fv = futureValue(egp(100_000), egp(30_000), 0.2, 60);
    // exact: 3,165,301.2535 EGP
    expect(fv).toBe(316_530_125);
  });

  it.each([
    ["zero return", 0, egp(100_000), egp(1_000), 12, egp(112_000)],
    ["zero contribution", 0.2, egp(100_000), 0, 12, egp(120_000)],
    ["zero periods", 0.2, egp(100_000), egp(1_000), 0, egp(100_000)],
    ["negative periods behave as zero", 0.2, egp(100_000), egp(1_000), -5, egp(100_000)],
  ])("%s", (_name, annual, pv, pmt, n, expected) => {
    expect(futureValue(pv, pmt, annual, n)).toBe(expected);
  });

  it("negative return shrinks the balance", () => {
    // 100k at -12% for 1 year, no contributions
    expect(futureValue(egp(100_000), 0, -0.12, 12)).toBe(egp(88_000));
    expect(futureValue(egp(100_000), egp(1_000), -0.12, 12)).toBeLessThan(egp(100_000 + 12_000));
  });

  it("handles billions of EGP without losing precision", () => {
    expect(futureValue(egp(5_000_000_000), 0, 0.2, 12)).toBe(egp(6_000_000_000));
    expect(futureValue(egp(5_000_000_000), egp(1_000_000), 0, 60)).toBe(egp(5_060_000_000));
  });

  it("throws rather than overflow the safe integer range", () => {
    expect(() => futureValue(egp(5_000_000_000), 0, 0.5, 1200)).toThrow(RangeError);
  });
});

describe("requiredMonthlyContribution", () => {
  it("fixture 2: 1.5M from 300k, 12%, 50 months", () => {
    const result = requiredMonthlyContribution(egp(1_500_000), egp(300_000), 0.12, 50);
    // exact: 16,020.18 EGP/month
    expect(result).toEqual(required(1_602_018));
  });

  it("fixture 3: zero return needs exactly 24,000/month", () => {
    expect(requiredMonthlyContribution(egp(1_500_000), egp(300_000), 0, 50)).toEqual(required(egp(24_000)));
  });

  it("the required amount actually reaches the target", () => {
    const result = requiredMonthlyContribution(egp(1_500_000), egp(300_000), 0.12, 50);
    if (result.kind !== "required") throw new Error("expected a number");
    const fv = futureValue(egp(300_000), result.monthly, 0.12, 50);
    expect(fv).toBeGreaterThanOrEqual(egp(1_500_000));
    expect(fv - egp(1_500_000)).toBeLessThan(100); // overshoot stays under 1 EGP
  });

  it("paying the required amount is on track, never a month late", () => {
    // nearest-piaster rounding used to leave this 3 piasters short
    const result = requiredMonthlyContribution(egp(1_100_000), egp(100_000), 0.1, 6);
    if (result.kind !== "required") throw new Error("expected a number");
    const status = goalStatus(egp(1_100_000), egp(100_000), result.monthly, 0.1, 6);
    expect(status.onTrack).toBe(true);
    expect(status.monthsLate).toBe(0);
    expect(requiredMonthlyContribution(100, 0, 0, 3)).toEqual(required(34));
  });

  it("reaches a target that lands exactly on the 100-year cap", () => {
    expect(monthsToTarget(egp(1_200_000), 0, egp(1_000), 1e-12)).toEqual({ kind: "months", months: 1200 });
  });

  it("is 0 when growth alone reaches the target", () => {
    expect(requiredMonthlyContribution(egp(100_000), egp(100_000), 0.1, 12)).toEqual(required(0));
    expect(requiredMonthlyContribution(egp(110_000), egp(100_000), 0.2, 12)).toEqual(required(0));
    expect(requiredMonthlyContribution(egp(50_000), egp(100_000), 0, 12)).toEqual(required(0));
  });

  it("reports a passed date instead of a number", () => {
    expect(requiredMonthlyContribution(egp(1_500_000), egp(300_000), 0.12, 0)).toEqual({
      kind: "target-date-passed",
    });
    expect(requiredMonthlyContribution(egp(1_500_000), egp(300_000), 0.12, -3)).toEqual({
      kind: "target-date-passed",
    });
  });

  it("an already-reached goal stays on track even after the date", () => {
    expect(requiredMonthlyContribution(egp(100_000), egp(200_000), 0.12, 0)).toEqual(required(0));
  });

  it("negative return needs more than the zero-return amount", () => {
    const result = requiredMonthlyContribution(egp(1_500_000), egp(300_000), -0.05, 50);
    expect(result.kind).toBe("required");
    if (result.kind === "required") expect(result.monthly).toBeGreaterThan(egp(24_000));
  });

  it("handles billions", () => {
    expect(requiredMonthlyContribution(egp(2_000_000_000), egp(1_000_000_000), 0, 100)).toEqual(
      required(egp(10_000_000)),
    );
  });
});

describe("monthsToTarget", () => {
  it("fixture 2: 15,000/month reaches 1.5M in 53 months", () => {
    expect(monthsToTarget(egp(1_500_000), egp(300_000), egp(15_000), 0.12)).toEqual(months(53));
  });

  it("fixture 2: the required contribution reaches it in exactly 50 months", () => {
    expect(monthsToTarget(egp(1_500_000), egp(300_000), 1_602_018, 0.12)).toEqual(months(50));
  });

  it("fixture 3: zero return", () => {
    expect(monthsToTarget(egp(1_500_000), egp(300_000), egp(24_000), 0)).toEqual(months(50));
    expect(monthsToTarget(egp(1_500_000), egp(300_000), egp(15_000), 0)).toEqual(months(80));
    expect(monthsToTarget(egp(1_500_000), egp(300_000), egp(24_001), 0)).toEqual(months(50));
    expect(monthsToTarget(egp(1_500_000), egp(300_000), egp(23_999), 0)).toEqual(months(51));
  });

  it("never lands a month late on exact answers", () => {
    // 12 x 1,000 at 0% must be exactly 12 months, whatever the float math says
    expect(monthsToTarget(egp(12_000), 0, egp(1_000), 0)).toEqual(months(12));
    // growth-only: 100k doubling at 100% effective annual = exactly 12 months
    expect(monthsToTarget(egp(200_000), egp(100_000), 0, 1)).toEqual(months(12));
  });

  it("agrees with futureValue: reached at n, not at n-1", () => {
    const [target, pv, pmt, annual] = [egp(2_000_000), egp(50_000), egp(7_000), 0.18];
    const result = monthsToTarget(target, pv, pmt, annual);
    if (result.kind !== "months") throw new Error("expected months");
    expect(futureValue(pv, pmt, annual, result.months)).toBeGreaterThanOrEqual(target);
    expect(futureValue(pv, pmt, annual, result.months - 1)).toBeLessThan(target);
  });

  it("is 0 when already reached", () => {
    expect(monthsToTarget(egp(100_000), egp(100_000), 0, 0.1)).toEqual(months(0));
    expect(monthsToTarget(egp(100_000), egp(250_000), 0, -0.1)).toEqual(months(0));
  });

  it("zero contribution grows to the target on returns alone", () => {
    // 100k at 20% needs ceil(ln(1.5)/ln(1.2)*12) = 27 months to reach 150k
    expect(monthsToTarget(egp(150_000), egp(100_000), 0, 0.2)).toEqual(months(27));
  });

  it.each([
    ["no contribution, no return", egp(1_000_000), egp(100_000), 0, 0],
    ["no contribution, negative return", egp(1_000_000), egp(100_000), 0, -0.05],
    ["negative contribution, no return", egp(1_000_000), egp(100_000), -1, 0],
    ["nothing at all", egp(1_000_000), 0, 0, 0.1],
    ["beyond 100 years", egp(1_000_000_000), egp(1_000), egp(1), 0],
  ])("unreachable: %s", (_name, target, pv, pmt, annual) => {
    expect(monthsToTarget(target, pv, pmt, annual)).toEqual({ kind: "unreachable" });
  });

  it("unreachable when losses outweigh contributions", () => {
    // balance converges to pmt / |r| ~ 1,000 / 0.00797 ~ 125k, below the 200k target
    expect(monthsToTarget(egp(200_000), egp(10_000), egp(1_000), -0.09)).toEqual({ kind: "unreachable" });
  });

  it("negative return still reachable when contributions are big enough", () => {
    const result = monthsToTarget(egp(100_000), egp(10_000), egp(5_000), -0.05);
    expect(result.kind).toBe("months");
  });

  it("allows up to the 100 year cap", () => {
    expect(monthsToTarget(egp(1_200_000), 0, egp(1_000), 0)).toEqual(months(1200));
    expect(monthsToTarget(egp(1_200_001), 0, egp(1_000), 0)).toEqual({ kind: "unreachable" });
  });

  it("handles billions", () => {
    expect(monthsToTarget(egp(5_000_000_000), egp(1_000_000_000), egp(40_000_000), 0)).toEqual(months(100));
  });
});

describe("goalStatus", () => {
  it("fixture 2: 15,000/month is 3 months late", () => {
    const s = goalStatus(egp(1_500_000), egp(300_000), egp(15_000), 0.12, 50);
    expect(s.onTrack).toBe(false);
    expect(s.monthsLate).toBe(3);
    expect(s.gap).toBe(s.projected - egp(1_500_000));
    expect(s.gap).toBeLessThan(0);
  });

  it("on track when the required contribution is paid", () => {
    const s = goalStatus(egp(1_500_000), egp(300_000), egp(17_000), 0.12, 50);
    expect(s.onTrack).toBe(true);
    expect(s.gap).toBeGreaterThan(0);
    expect(s.monthsLate).toBeLessThan(0);
  });

  it("exactly on target is on track, zero months late", () => {
    const s = goalStatus(egp(1_500_000), egp(300_000), egp(24_000), 0, 50);
    expect(s).toEqual({ onTrack: true, projected: egp(1_500_000), gap: 0, monthsLate: 0 });
  });

  it("already reached: early by the whole horizon", () => {
    const s = goalStatus(egp(100_000), egp(200_000), 0, 0, 12);
    expect(s).toEqual({ onTrack: true, projected: egp(200_000), gap: egp(100_000), monthsLate: -12 });
  });

  it("past goal date: projection is today's balance", () => {
    const s = goalStatus(egp(1_500_000), egp(300_000), egp(15_000), 0.12, 0);
    expect(s.projected).toBe(egp(300_000));
    expect(s.onTrack).toBe(false);
    expect(s.monthsLate).toBe(53);
  });

  it("unreachable has a gap but no months", () => {
    const s = goalStatus(egp(1_000_000), egp(100_000), 0, 0, 24);
    expect(s).toEqual({ onTrack: false, projected: egp(100_000), gap: egp(-900_000), monthsLate: null });
  });
});

describe("inflation helpers", () => {
  it("inflationAdjustedTarget compounds yearly", () => {
    expect(inflationAdjustedTarget(egp(1_000_000), 0.1, 2)).toBe(egp(1_210_000));
    expect(inflationAdjustedTarget(egp(1_000_000), 0, 10)).toBe(egp(1_000_000));
    expect(inflationAdjustedTarget(egp(1_000_000), 0.25, 0)).toBe(egp(1_000_000));
  });

  it("realRate is (1+r)/(1+i) - 1, not r - i", () => {
    expect(realRate(0.2, 0.2)).toBe(0);
    expect(realRate(0.32, 0.2)).toBeCloseTo(0.1, 12);
    expect(realRate(0.05, 0.1)).toBeCloseTo(-0.04545454545, 10);
  });
});
