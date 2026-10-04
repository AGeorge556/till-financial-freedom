import { describe, expect, it } from "vitest";
import { egpToPiasters as egp } from "./money";
import { type MixClass, mix, validateTargets, vsTarget } from "./portfolioMix";

const values = (stocks: number, gold: number, clouds: number, cash: number) => ({ stocks, gold, clouds, cash });
const bps = (v: ReturnType<typeof values>) => mix(v).lines.map((l) => l.bps);

describe("mix", () => {
  it("a plain split", () => {
    const m = mix(values(egp(50_000), egp(20_000), egp(10_000), egp(20_000)));
    expect(m.total).toBe(egp(100_000));
    expect(m.lines.map((l) => [l.class, l.value, l.percent])).toEqual([
      ["stocks", egp(50_000), 50],
      ["gold", egp(20_000), 20],
      ["clouds", egp(10_000), 10],
      ["cash", egp(20_000), 20],
    ]);
  });

  it.each([
    ["thirds over three classes", values(100, 100, 100, 0), [3334, 3333, 3333, 0]], // the extra hundredth goes to the first of the equal remainders
    ["four equal", values(1, 1, 1, 1), [2500, 2500, 2500, 2500]],
    ["a tiny class is not rounded away unfairly", values(1, 1, 1, 1_000_000), [0, 0, 0, 10000]],
    ["remainders decide, not the order", values(1, 2, 0, 0), [3333, 6667, 0, 0]],
    ["one class holds everything", values(0, 0, 0, egp(5)), [0, 0, 0, 10000]],
    ["no assets at all", values(0, 0, 0, 0), [0, 0, 0, 0]],
    ["an overdrawn account counts as 0", values(egp(100), 0, 0, -egp(50)), [10000, 0, 0, 0]],
  ])("%s", (_name, v, expected) => {
    expect(bps(v)).toEqual(expected);
  });

  it("always sums to exactly 10000 (100.00%) for awkward values", () => {
    const awkward = [1, 7, 333, 1_001, 99_999, 123_456_789, 987_654_321_012];
    let checked = 0;
    for (const a of awkward) for (const b of awkward) for (const c of awkward) for (const d of [0, 1, 17, 654_321]) {
      const total = bps(values(a, b, c, d)).reduce((s, x) => s + x, 0);
      expect(total).toBe(10000);
      checked++;
    }
    expect(checked).toBe(7 * 7 * 7 * 4);
  });

  it("shares stay within one hundredth of the exact figure", () => {
    const v = values(123_457, 234_567, 345_678, 456_789);
    const total = 123_457 + 234_567 + 345_678 + 456_789;
    mix(v).lines.forEach((l) => expect(Math.abs(l.bps - (v[l.class] * 10000) / total)).toBeLessThan(1));
  });

  it("is exact where float math would not be (values near 2^53 / 10000)", () => {
    const big = 900_000_000_000_000; // 9 trillion EGP in piasters
    expect(bps(values(big, big, big, 1))).toEqual([3334, 3333, 3333, 0]);
  });
});

describe("validateTargets", () => {
  const t = (a: number | null, b: number | null, c: number | null, d: number | null) => ({ stocks: a, gold: b, clouds: c, cash: d });

  it.each([
    ["none set", t(null, null, null, null), true],
    ["all four, totalling 100%", t(0.5, 0.2, 0.1, 0.2), true],
    ["a single class at 100%", t(1, 0, 0, 0), true],
    ["within 0.00001 of 100%", t(0.5, 0.2, 0.1, 0.200009), true],
    ["just outside 0.00001", t(0.5, 0.2, 0.1, 0.20002), false],
    ["99%", t(0.5, 0.2, 0.1, 0.19), false],
    ["101%", t(0.5, 0.2, 0.1, 0.21), false],
    ["only some set", t(0.5, 0.5, null, null), false],
    ["a negative target that still totals 100%", t(1.2, -0.2, 0, 0), false],
    ["a target above 100%", t(1.5, 0, 0, 0), false],
    ["not a number", t(Number.NaN, 0.5, 0.25, 0.25), false],
  ])("%s", (_name, input, ok) => {
    expect(validateTargets(input).ok).toBe(ok);
  });

  it("returns the targets when valid and null when none are set", () => {
    expect(validateTargets(t(null, null, null, null))).toEqual({ ok: true, targets: null });
    expect(validateTargets({})).toEqual({ ok: true, targets: null });
    expect(validateTargets(t(0.5, 0.2, 0.1, 0.2))).toEqual({ ok: true, targets: { stocks: 0.5, gold: 0.2, clouds: 0.1, cash: 0.2 } });
  });
});

describe("vsTarget", () => {
  const targets = { stocks: 0.5, gold: 0.2, clouds: 0.1, cash: 0.2 };

  it("shows the EGP difference and direction per class", () => {
    const m = mix(values(egp(58_000), egp(20_000), egp(10_000), egp(12_000)));
    const byClass = Object.fromEntries(vsTarget(m, targets).map((l) => [l.class, l])) as Record<MixClass, ReturnType<typeof vsTarget>[number]>;
    expect(byClass.stocks).toMatchObject({ targetValue: egp(50_000), difference: egp(8_000), direction: "above" });
    expect(byClass.gold).toMatchObject({ difference: 0, direction: "on" });
    expect(byClass.cash).toMatchObject({ targetValue: egp(20_000), difference: -egp(8_000), direction: "below" });
  });

  it("differences net to zero when the target values divide evenly", () => {
    const m = mix(values(egp(58_000), egp(20_000), egp(10_000), egp(12_000)));
    expect(vsTarget(m, targets).reduce((s, l) => s + l.difference, 0)).toBe(0);
  });

  it("with no assets everything is on target", () => {
    expect(vsTarget(mix(values(0, 0, 0, 0)), targets).map((l) => l.direction)).toEqual(["on", "on", "on", "on"]);
  });

  it("is information only: it returns figures, never trades", () => {
    const [line] = vsTarget(mix(values(egp(1), 0, 0, 0)), targets);
    expect(Object.keys(line).sort()).toEqual(["bps", "class", "difference", "direction", "percent", "target", "targetValue", "value"]);
  });
});
