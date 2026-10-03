import { describe, expect, it } from "vitest";
import {
  applyAllocationRules,
  percentOf,
  savingsTargetTotal,
  type AllocationRule,
} from "./allocation";
import { egpToPiasters as egp } from "./money";

let seq = 0;
const rule = (id: string, over: Partial<AllocationRule>): AllocationRule => ({
  id,
  kind: "fixed",
  targetKind: "goal",
  amount: null,
  percent: null,
  createdAt: `2026-01-01T00:00:${String(seq++).padStart(2, "0")}Z`,
  ...over,
});
const fixed = (id: string, priority: number, amountEgp: number) =>
  rule(id, { kind: "fixed", priority, amount: egp(amountEgp) });
const bucketFixed = (id: string, amountEgp: number) =>
  rule(id, { kind: "fixed", targetKind: "cash", amount: egp(amountEgp) });
const pct = (id: string, percent: number, over: Partial<AllocationRule> = { targetKind: "investments" }) =>
  rule(id, { kind: "percentage", percent, ...over });
const remainder = (id: string) => rule(id, { kind: "remainder", targetKind: "investments" });

const funded = (plan: ReturnType<typeof applyAllocationRules>) => plan.rules.map((r) => r.funded);
const shortfalls = (plan: ReturnType<typeof applyAllocationRules>) => plan.rules.map((r) => r.shortfall);
const run = (capacityEgp: number, rules: AllocationRule[], overrides = [] as { ruleId: string; amount: number }[], targetEgp = capacityEgp) =>
  applyAllocationRules({ capacity: egp(capacityEgp), target: egp(targetEgp), rules, overrides });

describe("applyAllocationRules", () => {
  it("spec example: 30,000 capacity, three fixed goals, remainder to investments", () => {
    const plan = run(30000, [fixed("marriage", 1, 10000), fixed("realestate", 2, 8000), fixed("emergency", 3, 2000), remainder("inv")]);
    expect(funded(plan)).toEqual([egp(10000), egp(8000), egp(2000), egp(10000)]);
    expect(shortfalls(plan)).toEqual([0, 0, 0, 0]);
    expect(plan.distributed).toBe(egp(30000));
    expect(plan.unallocated).toBe(0);
    expect(plan.fixedExceedsTargetBy).toBe(0);
  });

  it("funds fixed rules by goal priority, then buckets, whatever the input order", () => {
    const plan = run(15000, [bucketFixed("cashbucket", 5000), fixed("low", 3, 5000), fixed("high", 1, 10000), fixed("mid", 2, 5000)]);
    // order of result follows the input; funding followed priority: high 10,000 -> mid 5,000 -> nothing left
    expect(funded(plan)).toEqual([0, 0, egp(10000), egp(5000)]);
    expect(shortfalls(plan)).toEqual([egp(5000), egp(5000), 0, 0]);
  });

  it("shortfall lands on the lowest-priority fixed targets; percentage and remainder get 0", () => {
    const rules = [fixed("g1", 1, 10000), fixed("g2", 2, 8000), fixed("g3", 3, 2000), fixed("g4", 4, 10000), pct("p", 0.5), remainder("r")];
    const plan = run(24000, rules);
    expect(funded(plan)).toEqual([egp(10000), egp(8000), egp(2000), egp(4000), 0, 0]);
    expect(shortfalls(plan)).toEqual([0, 0, 0, egp(6000), 0, 0]);
    expect(plan.distributed).toBe(egp(24000));
  });

  it("a shortfall can cut through several targets", () => {
    const plan = run(15000, [fixed("g1", 1, 10000), fixed("g2", 2, 8000), fixed("g3", 3, 2000)]);
    expect(funded(plan)).toEqual([egp(10000), egp(5000), 0]);
    expect(shortfalls(plan)).toEqual([0, egp(3000), egp(2000)]);
  });

  it("percentage rules take a share of the capacity left after fixed rules; remainder takes the rest", () => {
    const plan = run(30000, [fixed("g1", 1, 10000), pct("half", 0.5), pct("quarter", 0.25), remainder("r")]);
    expect(funded(plan)).toEqual([egp(10000), egp(10000), egp(5000), egp(5000)]);
    expect(plan.unallocated).toBe(0);
  });

  it("rounds percentages down to whole piasters and leaves the leftover unallocated or to the remainder", () => {
    const thirds = [pct("a", 0.333333), pct("b", 0.333333)];
    const without = applyAllocationRules({ capacity: 1000, target: 1000, rules: thirds, overrides: [] });
    expect(funded(without)).toEqual([333, 333]);
    expect(without.unallocated).toBe(334);
    const withRemainder = applyAllocationRules({ capacity: 1000, target: 1000, rules: [...thirds, remainder("r")], overrides: [] });
    expect(funded(withRemainder)).toEqual([333, 333, 334]);
    expect(withRemainder.unallocated).toBe(0);
  });

  it("percentages summing past 100% never distribute more than is available", () => {
    const plan = applyAllocationRules({ capacity: 1000, target: 1000, rules: [pct("a", 0.7), pct("b", 0.7)], overrides: [] });
    expect(funded(plan)).toEqual([700, 300]);
    expect(plan.distributed).toBe(1000);
  });

  it("an override replaces one rule's amount for that month only and never edits the rule", () => {
    const rules = [fixed("g1", 1, 10000), fixed("g2", 2, 8000), remainder("r")];
    const normal = run(30000, rules);
    const overridden = run(30000, rules, [{ ruleId: "g1", amount: egp(3000) }]);
    expect(funded(normal)).toEqual([egp(10000), egp(8000), egp(12000)]);
    expect(funded(overridden)).toEqual([egp(3000), egp(8000), egp(19000)]);
    expect(overridden.rules[0].planned).toBe(egp(3000));
    expect(rules[0].amount).toBe(egp(10000));
    expect(funded(run(30000, rules))).toEqual(funded(normal));
  });

  it("an override of 0 skips the rule for the month, and one on a percentage rule makes it a fixed amount", () => {
    const rules = [fixed("g1", 1, 10000), pct("p", 0.5), remainder("r")];
    const plan = run(30000, rules, [{ ruleId: "g1", amount: 0 }, { ruleId: "p", amount: egp(4000) }]);
    expect(funded(plan)).toEqual([0, egp(4000), egp(26000)]);
  });

  it("reports how far fixed rules exceed a fixed savings target, and distributes only the target", () => {
    const rules = [fixed("g1", 1, 15000), fixed("g2", 2, 10000), remainder("r")];
    const target = savingsTargetTotal("fixed", egp(20000), null, null, egp(30000));
    const plan = applyAllocationRules({ capacity: egp(30000), target, rules, overrides: [] });
    expect(plan.fixedExceedsTargetBy).toBe(egp(5000));
    expect(funded(plan)).toEqual([egp(15000), egp(5000), 0]);
    expect(shortfalls(plan)).toEqual([0, egp(5000), 0]);
    expect(plan.distributed).toBe(egp(20000));
  });

  it("a savings target below capacity leaves the rest of the capacity out of the distribution", () => {
    const plan = run(30000, [fixed("g1", 1, 5000), remainder("r")], [], 12000);
    expect(funded(plan)).toEqual([egp(5000), egp(7000)]);
    expect(plan.unallocated).toBe(0);
  });

  it("negative or zero capacity funds nothing and reports every shortfall", () => {
    for (const capacity of [-5000, 0]) {
      const plan = run(capacity, [fixed("g1", 1, 10000), bucketFixed("b", 2000), pct("p", 0.5), remainder("r")], [], 30000);
      expect(funded(plan)).toEqual([0, 0, 0, 0]);
      expect(shortfalls(plan)).toEqual([egp(10000), egp(2000), 0, 0]);
      expect(plan.distributed).toBe(0);
      expect(plan.unallocated).toBe(0);
    }
  });

  it("rejects two remainder rules and non-integer capacity", () => {
    expect(() => run(1000, [remainder("a"), remainder("b")])).toThrow(RangeError);
    expect(() => applyAllocationRules({ capacity: 10.5, target: 10, rules: [], overrides: [] })).toThrow(RangeError);
  });
});

describe("percentOf", () => {
  it.each([
    [100, 0.57, 57], // 100 * 0.57 is 56.99999999999999 in floats
    [1000, 0.333333, 333],
    [0, 0.5, 0],
    [-500, 0.5, 0],
    [12345, 1, 12345],
  ])("percentOf(%i, %f) = %i", (base, rate, expected) => {
    expect(percentOf(base, rate)).toBe(expected);
  });
});

describe("savingsTargetTotal", () => {
  it.each([
    ["fixed", egp(20000), null, null, egp(30000), egp(20000)],
    ["percentage", null, 0.2, egp(50000), egp(30000), egp(10000)],
    ["percentage", null, 0.2, null, egp(30000), 0],
    ["flexible", egp(1), 0.9, egp(1), egp(30000), egp(30000)],
    ["flexible", null, null, null, -egp(500), 0],
  ] as const)("%s", (mode, amount, percent, income, capacity, expected) => {
    expect(savingsTargetTotal(mode, amount, percent, income, capacity)).toBe(expected);
  });
});
