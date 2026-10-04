import { blendedReturn, goalProjection } from "./goals";
import { roundPiasters, type Piasters } from "./money";
import { MIX_CLASSES, type MixClass } from "./portfolioMix";
import { inflationAdjustedTarget, MAX_MONTHS, monthlyRate } from "./projection";
import { addDays } from "./recurring";
import { financialMonth } from "./time";

/**
 * The scenario calculator: pure, deterministic, nothing is stored. Each class grows at its own assumed annual rate
 * (turned into a monthly rate with monthlyRate, never annual / 12); the month's contribution lands at the END of the
 * month, after that month's growth. Income grows once a year; spending and liabilities stay flat (no auto-payoff).
 * These are assumptions, not forecasts.
 */
const INVESTED = ["stocks", "gold", "clouds"] as const;
type Invested = (typeof INVESTED)[number];
const MAX_YEARS = MAX_MONTHS / 12;

export type ScenarioGoal = {
  id: string;
  name: string;
  target: Piasters;
  targetDate: string;
  /** What the goal holds today. */
  current: Piasters;
  /** What it is planned to receive each month, as given: it is not rescaled when the savings above are changed. */
  plannedMonthly: Piasters;
  /** What backs the goal, to blend the scenario's class returns into the goal's own rate. */
  sources: { class: MixClass; value: Piasters }[];
  returnOverride: number | null;
  contributedThisMonth: boolean;
};

export type ScenarioInput = {
  today: string;
  startDay: number;
  /** Per month, in today's terms. */
  monthlyIncome: Piasters;
  /** Yearly growth of income, a decimal (0.05 = 5%); applied once at the start of each later year. */
  incomeGrowth: number;
  monthlySpending: Piasters;
  /** null = income - spending, which then moves as income grows; a figure is held flat. */
  monthlySavings: Piasters | null;
  /** The part of each month's savings that is invested; the rest of the savings stays in cash. */
  monthlyInvestment: Piasters;
  /** Expected annual return per class (decimals). */
  returns: Record<MixClass, number>;
  /** What each class is worth today. */
  startValues: Record<MixClass, Piasters>;
  /** How the invested part splits across stocks, gold and clouds (allocation rules); null = today's mix of those three. */
  investSplit: Record<Invested, number> | null;
  liabilities: Piasters;
  years: number;
  /** Annual inflation, a decimal; null = leave out the real-terms figures. */
  inflation: number | null;
  goals: ScenarioGoal[];
};

export type ScenarioRow = {
  /** 0 = today. */
  year: number;
  netWorth: Piasters;
  byClass: Record<MixClass, Piasters>;
  /** Stocks, gold and clouds together. */
  investments: Piasters;
  /** netWorth in today's money; only when inflation is set. */
  realNetWorth?: Piasters;
};

export type GoalOutcome = {
  id: string;
  name: string;
  /** Rate the goal grows at under the scenario's class returns. */
  annualReturn: number;
  monthsRemaining: number;
  projectedAtTarget: Piasters;
  onTrack: boolean;
  /** Positive = late, negative = early, null = never. */
  monthsLate: number | null;
  /** The month the goal is reached at the planned amount; null = never within 100 years. */
  completionDate: string | null;
  /** Needed each month to hit the target by its date; null = the date has passed. */
  requiredMonthly: Piasters | null;
  /** The same goal against its target raised by inflation (target x (1+i)^years). Only with inflation set. */
  adjusted?: { target: Piasters; onTrack: boolean; monthsLate: number | null; completionDate: string | null; requiredMonthly: Piasters | null };
};

export type ScenarioResult = {
  rows: ScenarioRow[];
  goals: GoalOutcome[];
  /** Planned goal contributions add up to more than the first year's monthly savings. */
  goalsExceedSavings: boolean;
  /** The assumptions this result came from. */
  used: {
    monthlySavings: Piasters;
    monthlyInvestment: Piasters;
    investSplit: Record<Invested, number>;
    splitSource: "rules" | "current-mix";
    returns: Record<MixClass, number>;
    incomeGrowth: number;
    inflation: number | null;
  };
};

function check(input: ScenarioInput): void {
  const money = [input.monthlyIncome, input.monthlySpending, input.monthlyInvestment, input.liabilities, ...MIX_CLASSES.map((c) => input.startValues[c])];
  if (input.monthlySavings !== null) money.push(input.monthlySavings);
  if (money.some((m) => !Number.isSafeInteger(m))) throw new RangeError("Scenario amounts must be whole piasters");
  if (!Number.isInteger(input.years) || input.years < 0 || input.years > MAX_YEARS) throw new RangeError(`Years must be 0-${MAX_YEARS}: ${input.years}`);
  const rates = [input.incomeGrowth, ...MIX_CLASSES.map((c) => input.returns[c])];
  if (input.inflation !== null) rates.push(input.inflation);
  if (rates.some((r) => !Number.isFinite(r) || r <= -1)) throw new RangeError("Rates must be above -100%");
}

function split(input: ScenarioInput): { weights: Record<Invested, number>; source: "rules" | "current-mix" } {
  const raw = input.investSplit ?? { stocks: input.startValues.stocks, gold: input.startValues.gold, clouds: input.startValues.clouds };
  const total = INVESTED.reduce((s, c) => s + Math.max(0, raw[c]), 0);
  // Nothing held and no rules: the invested part goes to stocks rather than vanishing.
  if (total === 0) return { weights: { stocks: 1, gold: 0, clouds: 0 }, source: input.investSplit ? "rules" : "current-mix" };
  const w = (c: Invested) => Math.max(0, raw[c]) / total;
  return { weights: { stocks: w("stocks"), gold: w("gold"), clouds: w("clouds") }, source: input.investSplit ? "rules" : "current-mix" };
}

/** End date of the financial month holding the m-th contribution (m >= 1), counting from the first one still to come. */
function contributionDate(today: string, startDay: number, contributedThisMonth: boolean, m: number): string {
  let end = financialMonth(today, startDay).end;
  for (let i = (contributedThisMonth ? 1 : 0) + m - 1; i > 0; i--) end = financialMonth(addDays(end, 1), startDay).end;
  return end;
}

export function projectScenario(input: ScenarioInput): ScenarioResult {
  check(input);
  const { weights, source } = split(input);
  const monthly = Object.fromEntries(MIX_CLASSES.map((c) => [c, monthlyRate(input.returns[c])])) as Record<MixClass, number>;
  const values = Object.fromEntries(MIX_CLASSES.map((c) => [c, input.startValues[c] as number])) as Record<MixClass, number>;

  const savingsInYear = (year: number) =>
    input.monthlySavings ?? input.monthlyIncome * (1 + input.incomeGrowth) ** year - input.monthlySpending;
  const investedInYear = (year: number) => Math.min(Math.max(0, input.monthlyInvestment), Math.max(0, savingsInYear(year)));

  const row = (year: number): ScenarioRow => {
    const byClass = Object.fromEntries(MIX_CLASSES.map((c) => [c, roundPiasters(values[c])])) as Record<MixClass, Piasters>;
    const assets = MIX_CLASSES.reduce((s, c) => s + values[c], 0);
    const net = assets - input.liabilities;
    return {
      year,
      netWorth: roundPiasters(net),
      byClass,
      investments: roundPiasters(INVESTED.reduce((s, c) => s + values[c], 0)),
      ...(input.inflation === null ? {} : { realNetWorth: roundPiasters(net / (1 + input.inflation) ** year) }),
    };
  };

  const rows = [row(0)];
  for (let year = 0; year < input.years; year++) {
    const savings = savingsInYear(year);
    const invested = investedInYear(year);
    for (let month = 0; month < 12; month++) {
      for (const c of MIX_CLASSES) values[c] *= 1 + monthly[c];
      for (const c of INVESTED) values[c] += invested * weights[c];
      values.cash += savings - invested;
    }
    rows.push(row(year + 1));
  }

  const goals = input.goals.map((g) => goalOutcome(input, g));
  const first = savingsInYear(0);
  return {
    rows,
    goals,
    goalsExceedSavings: input.goals.reduce((s, g) => s + g.plannedMonthly, 0) > Math.max(0, first),
    used: {
      monthlySavings: roundPiasters(first),
      monthlyInvestment: roundPiasters(investedInYear(0)),
      investSplit: weights,
      splitSource: source,
      returns: input.returns,
      incomeGrowth: input.incomeGrowth,
      inflation: input.inflation,
    },
  };
}

function goalOutcome(input: ScenarioInput, g: ScenarioGoal): GoalOutcome {
  const { rate: annualReturn } = blendedReturn(
    g.sources.map((s) => ({ value: s.value, rate: input.returns[s.class] })),
    g.returnOverride,
  );
  const run = (target: Piasters) => {
    const p = goalProjection({
      target,
      current: g.current,
      plannedMonthly: g.plannedMonthly,
      annualReturn,
      today: input.today,
      targetDate: g.targetDate,
      startDay: input.startDay,
      contributedThisMonth: g.contributedThisMonth,
    });
    const completionDate =
      p.projectedMonths === "unreachable"
        ? null
        : p.projectedMonths === 0
          ? input.today
          : contributionDate(input.today, input.startDay, g.contributedThisMonth, p.projectedMonths);
    return { p, completionDate, requiredMonthly: p.required === "target-date-passed" ? null : p.required };
  };

  const nominal = run(g.target);
  const out: GoalOutcome = {
    id: g.id,
    name: g.name,
    annualReturn,
    monthsRemaining: nominal.p.monthsRemaining,
    projectedAtTarget: nominal.p.projectedAtTarget,
    onTrack: nominal.p.onTrack,
    monthsLate: nominal.p.monthsLate,
    completionDate: nominal.completionDate,
    requiredMonthly: nominal.requiredMonthly,
  };
  if (input.inflation !== null) {
    const target = inflationAdjustedTarget(g.target, input.inflation, nominal.p.monthsRemaining / 12);
    const adj = run(target);
    out.adjusted = { target, onTrack: adj.p.onTrack, monthsLate: adj.p.monthsLate, completionDate: adj.completionDate, requiredMonthly: adj.requiredMonthly };
  }
  return out;
}
