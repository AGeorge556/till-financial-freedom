import type { Piasters } from "./money";

export type RuleKind = "fixed" | "percentage" | "remainder";
export type TargetKind = "goal" | "investments" | "cash";
export type SavingsTargetMode = "fixed" | "percentage" | "flexible";

export interface AllocationRule {
  id: string;
  kind: RuleKind;
  targetKind: TargetKind;
  /** Priority of the targeted goal (1 = highest). Ignored for bucket rules. */
  priority?: number;
  amount: Piasters | null;
  /** Decimal: 0.25 = 25%. */
  percent: number | null;
  /** Sortable creation stamp (ISO string); breaks priority ties and orders bucket rules. */
  createdAt: string;
}

/** The overrides of ONE financial month: the amount replaces that rule's amount for the month only. */
export interface AllocationOverride {
  ruleId: string;
  amount: Piasters;
}

export interface RuleOutcome {
  ruleId: string;
  planned: Piasters;
  funded: Piasters;
  shortfall: Piasters;
}

export interface AllocationPlan {
  /** In the order the rules were passed in. */
  rules: RuleOutcome[];
  distributed: Piasters;
  /** Part of the savings total no rule took. */
  unallocated: Piasters;
  /** Fixed amounts beyond the savings total (0 if they fit). */
  fixedExceedsTargetBy: Piasters;
}

/** floor(base * rate) in exact integer math; rates have at most 6 decimals (numeric(8,6)). */
export function percentOf(base: Piasters, rate: number): Piasters {
  if (base <= 0 || rate <= 0) return 0;
  return Number((BigInt(base) * BigInt(Math.round(rate * 1e6))) / BigInt(1000000));
}

/** Rule G: the total the rules distribute. Flexible = capacity (never below 0). */
export function savingsTargetTotal(
  mode: SavingsTargetMode,
  amount: Piasters | null,
  percent: number | null,
  income: Piasters | null,
  capacity: Piasters,
): Piasters {
  switch (mode) {
    case "fixed":
      return Math.max(0, amount ?? 0);
    case "percentage":
      return percentOf(income ?? 0, percent ?? 0);
    case "flexible":
      return Math.max(0, capacity);
  }
}

function compareRules(a: AllocationRule, b: AllocationRule): number {
  const ga = a.targetKind === "goal" ? 0 : 1;
  const gb = b.targetKind === "goal" ? 0 : 1;
  if (ga !== gb) return ga - gb;
  const byPriority = ga === 0 ? (a.priority ?? Infinity) - (b.priority ?? Infinity) : 0;
  if (byPriority !== 0) return byPriority;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

/**
 * Rule F: fixed (goals by priority, then buckets) -> percentage of what is left after fixed -> one remainder.
 * An override turns its rule into a fixed amount for that month. `target` is the savings total (rule G);
 * what is distributed never exceeds min(capacity, target), and never goes below 0.
 */
export function applyAllocationRules(input: {
  capacity: Piasters;
  target: Piasters;
  rules: AllocationRule[];
  overrides: AllocationOverride[];
}): AllocationPlan {
  const { capacity, target, rules, overrides } = input;
  if (!Number.isSafeInteger(capacity) || !Number.isSafeInteger(target)) {
    throw new RangeError(`Capacity and target must be whole piasters, got ${capacity} and ${target}`);
  }
  if (rules.filter((r) => r.kind === "remainder").length > 1) {
    throw new RangeError("At most one remainder rule is allowed");
  }
  const override = new Map(overrides.map((o) => [o.ruleId, o.amount]));
  const sorted = [...rules].sort(compareRules);
  const pool = Math.max(0, Math.min(capacity, target));

  const outcome = new Map<string, RuleOutcome>();
  let left = pool;
  let fixedTotal = 0;

  for (const r of sorted) {
    const planned = override.get(r.id) ?? (r.kind === "fixed" ? (r.amount ?? 0) : null);
    if (planned === null) continue;
    const funded = Math.min(planned, left);
    left -= funded;
    fixedTotal += planned;
    outcome.set(r.id, { ruleId: r.id, planned, funded, shortfall: planned - funded });
  }

  // Every percentage is of the same base: what is left once the fixed rules are funded.
  const base = left;
  for (const r of sorted) {
    if (r.kind !== "percentage" || outcome.has(r.id)) continue;
    const funded = Math.min(percentOf(base, r.percent ?? 0), left);
    left -= funded;
    outcome.set(r.id, { ruleId: r.id, planned: funded, funded, shortfall: 0 });
  }

  for (const r of sorted) {
    if (r.kind !== "remainder" || outcome.has(r.id)) continue;
    outcome.set(r.id, { ruleId: r.id, planned: left, funded: left, shortfall: 0 });
    left = 0;
  }

  const result = rules.map((r) => outcome.get(r.id)!);
  return {
    rules: result,
    distributed: pool - left,
    unallocated: left,
    fixedExceedsTargetBy: Math.max(0, fixedTotal - Math.max(0, target)),
  };
}
