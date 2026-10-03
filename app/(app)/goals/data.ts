import "server-only";
import { shiftMonth } from "@/components/GoalFormat";
import {
  type AccountRow,
  type AllocationEventRow,
  accountBalances,
  type Assumptions,
  getAssumptions,
  getPlanSettings,
  getSettings,
  type GoalRow,
  listAccounts,
  listAllocationEvents,
  listGoalAllocations,
  listGoals,
  listOverrides,
  listRules,
  listTransactions,
  type PlanSettings,
  type RuleRow,
  toLedgerTx,
  type TransactionRow,
} from "@/db/queries";
import {
  type AllocationPlan,
  type AllocationRule,
  applyAllocationRules,
  type RuleOutcome,
  savingsTargetTotal,
} from "@/lib/finance-core/allocation";
import {
  accountFree,
  actualContribution,
  blendedReturn,
  goalCurrentAmount,
  goalProjection,
  type GoalProjection,
  overAllocatedBy,
  plannedMonthly,
  trailingCapacity,
} from "@/lib/finance-core/goals";
import { filterByDateRange, periodSummary } from "@/lib/finance-core/ledger";
import type { Piasters } from "@/lib/finance-core/money";
import { cairoToday, financialMonth } from "@/lib/finance-core/time";

export type AccountView = {
  id: string;
  name: string;
  type: AccountRow["type"];
  archived: boolean;
  isInvestment: boolean;
  balance: Piasters;
  allocated: Piasters;
  free: Piasters;
  over: Piasters;
};

export type GoalAllocationView = {
  accountId: string;
  accountName: string;
  accountArchived: boolean;
  amount: Piasters;
  free: Piasters;
  /** The account's own over-allocation, shared by every goal earmarking money there. */
  over: Piasters;
};

export type GoalView = {
  goal: GoalRow;
  current: Piasters;
  currentSource: "allocations" | "manual";
  allocations: GoalAllocationView[];
  /**
   * This goal's share of its accounts' over-allocation. Each account's figure is attributed across the goals
   * earmarking there, newest allocation first, so the shares of all goals add up to exactly that figure.
   */
  overAllocatedBy: Piasters;
  rate: number;
  rateSource: "override" | "blended";
  /** The goal has linked accounts but no cash return is set, so they count as 0%. */
  cashReturnMissing: boolean;
  planned: Piasters;
  plannedSource: "rules" | "goal";
  ruleShortfall: Piasters;
  /** Net new allocations in this financial month. */
  actual: Piasters;
  projection: GoalProjection;
};

export type RuleView = {
  rule: RuleRow;
  goalName: string | null;
  /** Rules aimed at an archived goal are listed but not funded (outcome is null). */
  goalArchived: boolean;
  outcome: RuleOutcome | null;
  overrideAmount: Piasters | null;
};

export type GoalData = {
  today: string;
  startDay: number;
  month: { start: string; end: string };
  /** 'YYYY-MM' of the start of the current financial month. */
  monthKey: string;
  accounts: AccountView[];
  /** Every goal, archived included, by priority. */
  goals: GoalView[];
  events: AllocationEventRow[];
  rules: RuleView[];
  settings: PlanSettings;
  assumptions: Assumptions;
  plan: {
    basis: "average" | "entered";
    income: Piasters;
    spending: Piasters;
    capacity: Piasters;
    /** Not enough history and the owner has not entered income and spending. */
    inputsMissing: boolean;
    target: Piasters;
    outcome: AllocationPlan;
    shortfallTotal: Piasters;
  };
  /** Active goals only: planned vs contributed this financial month. */
  totals: { planned: Piasters; actual: Piasters };
};

type Preloaded = { accounts: AccountRow[]; txRows: TransactionRow[]; monthStartDay: number };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

async function loadBase(userId: string): Promise<Preloaded> {
  const [accounts, txRows, { monthStartDay }] = await Promise.all([
    listAccounts(userId, { includeArchived: true }),
    listTransactions(userId),
    getSettings(userId),
  ]);
  return { accounts, txRows, monthStartDay };
}

/**
 * Everything the goal screens show, computed with finance-core. `preloaded` lets a page that already read the
 * accounts and every transaction (Home) skip reading them again.
 */
export async function loadGoalData(userId: string, preloaded?: Preloaded): Promise<GoalData> {
  const { accounts, txRows, monthStartDay: startDay } = preloaded ?? (await loadBase(userId));
  const today = cairoToday();
  const month = financialMonth(today, startDay);
  const monthKey = month.start.slice(0, 7);

  const [goalRows, allocRows, events, ruleRows, overrides, ps, assumptions] = await Promise.all([
    listGoals(userId, { includeArchived: true }),
    listGoalAllocations(userId),
    listAllocationEvents(userId),
    listRules(userId),
    listOverrides(userId, monthKey),
    getPlanSettings(userId),
    getAssumptions(userId),
  ]);

  // Accounts and what is earmarked on them (archived goals' earmarks still count: the money is still set aside).
  const balances = accountBalances(accounts, txRows);
  const allocatedOn = new Map<string, Piasters>();
  for (const a of allocRows) allocatedOn.set(a.accountId, (allocatedOn.get(a.accountId) ?? 0) + a.amount);
  const accountViews: AccountView[] = accounts.map((a) => {
    const balance = balances.get(a.id) ?? 0;
    const allocated = allocatedOn.get(a.id) ?? 0;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      archived: a.archivedAt !== null,
      isInvestment: a.isInvestment,
      balance,
      allocated,
      free: accountFree(balance, allocated),
      over: overAllocatedBy(balance, allocated),
    };
  });
  const accountById = new Map(accountViews.map((a) => [a.id, a]));
  const overShare = new Map<string, Piasters>(); // allocation id -> its share of the account's over-allocation
  for (const acct of accountViews) {
    let left = acct.over;
    const newestFirst = allocRows
      .filter((a) => a.accountId === acct.id)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1));
    for (const a of newestFirst) {
      const share = Math.min(a.amount, left);
      overShare.set(a.id, share);
      left -= share;
    }
  }

  // Rule H: the average of the 3 full financial months before this one, else what the owner entered.
  const ledger = txRows.map(toLedgerTx);
  const firstDate = ledger.reduce<string | null>(
    (min, t) => (t.status === "void" || (min !== null && min <= t.date) ? min : t.date),
    null,
  );
  const dd = String(startDay).padStart(2, "0");
  const history = [3, 2, 1].map((back) => {
    const r = financialMonth(`${shiftMonth(monthKey, -back)}-${dd}`, startDay);
    const s = periodSummary(filterByDateRange(ledger, r.start, r.end));
    // A month counts only if tracking began on or before its first day.
    return { income: s.totalIncome, spending: s.spending, full: firstDate !== null && firstDate <= r.start };
  });
  const trailing = trailingCapacity(history);
  const income = trailing ? trailing.income : (ps.expectedMonthlyIncome ?? 0);
  const spending = trailing ? trailing.spending : (ps.expectedMonthlySpending ?? 0);
  const capacity = income - spending;
  const target = savingsTargetTotal(ps.savingsTargetMode, ps.savingsTargetAmount, ps.savingsTargetPercent, income, capacity);

  // Rules.
  const goalById = new Map(goalRows.map((g) => [g.id, g]));
  const fundable = (r: RuleRow) => r.goalId === null || goalById.get(r.goalId)?.archivedAt === null;
  const active = ruleRows.filter(fundable);
  const engineRules: AllocationRule[] = active.map((r) => ({
    id: r.id,
    kind: r.kind,
    targetKind: r.targetKind,
    priority: r.goalId ? goalById.get(r.goalId)?.priority : undefined,
    amount: r.amount,
    percent: r.percent,
    createdAt: r.createdAt.toISOString(),
  }));
  const activeIds = new Set(active.map((r) => r.id));
  const outcome = applyAllocationRules({
    capacity,
    target,
    rules: engineRules,
    overrides: overrides.filter((o) => activeIds.has(o.ruleId)).map((o) => ({ ruleId: o.ruleId, amount: o.amount })),
  });
  const outcomeOf = new Map(outcome.rules.map((o) => [o.ruleId, o]));
  const overrideOf = new Map(overrides.map((o) => [o.ruleId, o.amount]));
  const ruleViews: RuleView[] = ruleRows.map((rule) => ({
    rule,
    goalName: rule.goalId ? (goalById.get(rule.goalId)?.name ?? null) : null,
    goalArchived: !fundable(rule),
    outcome: outcomeOf.get(rule.id) ?? null,
    overrideAmount: overrideOf.get(rule.id) ?? null,
  }));

  // Goals.
  const goalViews: GoalView[] = goalRows.map((goal) => {
    const allocs = allocRows.filter((a) => a.goalId === goal.id);
    const current = goalCurrentAmount(
      allocs.map((a) => a.amount),
      goal.manualCurrent,
    );
    const ret = blendedReturn(
      allocs.map((a) => ({ value: a.amount, rate: assumptions.cashReturn })),
      goal.expectedReturnOverride,
    );
    const mine = ruleViews.filter((r) => r.rule.goalId === goal.id && r.outcome);
    const planned = plannedMonthly(
      mine.length > 0 ? sum(mine.map((r) => r.outcome!.funded)) : null,
      goal.plannedMonthly,
    );
    const actual = actualContribution(
      events.filter((e) => e.goalId === goal.id),
      month,
    );
    const allocations = allocs.map((a): GoalAllocationView => {
      const acct = accountById.get(a.accountId);
      return {
        accountId: a.accountId,
        accountName: acct?.name ?? "Unknown account",
        accountArchived: acct?.archived ?? false,
        amount: a.amount,
        free: acct?.free ?? 0,
        over: acct?.over ?? 0,
      };
    });
    return {
      goal,
      current: current.amount,
      currentSource: current.source,
      allocations,
      overAllocatedBy: sum(allocs.map((a) => overShare.get(a.id) ?? 0)),
      rate: ret.rate,
      rateSource: ret.source,
      cashReturnMissing: ret.source === "blended" && allocs.length > 0 && assumptions.cashReturn === null,
      planned: planned.amount,
      plannedSource: planned.source,
      ruleShortfall: sum(mine.map((r) => r.outcome!.shortfall)),
      actual,
      projection: goalProjection({
        target: goal.targetAmount,
        current: current.amount,
        plannedMonthly: planned.amount,
        annualReturn: ret.rate,
        today,
        targetDate: goal.targetDate,
        startDay,
        contributedThisMonth: actual > 0,
      }),
    };
  });
  const activeGoals = goalViews.filter((v) => !v.goal.archivedAt);

  return {
    today,
    startDay,
    month,
    monthKey,
    accounts: accountViews,
    goals: goalViews,
    events,
    rules: ruleViews,
    settings: ps,
    assumptions,
    plan: {
      basis: trailing ? "average" : "entered",
      income,
      spending,
      capacity,
      inputsMissing: !trailing && (ps.expectedMonthlyIncome === null || ps.expectedMonthlySpending === null),
      target,
      outcome,
      shortfallTotal: sum(outcome.rules.map((r) => r.shortfall)),
    },
    totals: { planned: sum(activeGoals.map((v) => v.planned)), actual: sum(activeGoals.map((v) => v.actual)) },
  };
}
