"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { parseEGP } from "@/lib/finance-core/money";
import { MIX_CLASSES, MIX_LABELS, type MixClass } from "@/lib/finance-core/portfolioMix";
import { projectScenario, type GoalOutcome, type ScenarioInput, type ScenarioResult } from "@/lib/finance-core/scenario";
import { Amount } from "./Amount";
import { BarChart } from "./charts/BarChart";
import { formatMonthYear } from "./dates";
import { egpText, formatRate, monthsLateText, ratePercentText } from "./GoalFormat";
import { usePrivacy } from "./PrivacyProvider";
import { Field, field, secondaryBtn, card } from "./ui";

type State = {
  income: string;
  growth: string;
  spending: string;
  savings: string;
  investment: string;
  returns: Record<MixClass, string>;
  inflation: string;
  years: number;
};

const start = (i: ScenarioInput): State => ({
  income: egpText(i.monthlyIncome),
  growth: ratePercentText(i.incomeGrowth),
  spending: egpText(i.monthlySpending),
  savings: i.monthlySavings === null ? "" : egpText(i.monthlySavings),
  investment: egpText(i.monthlyInvestment),
  returns: Object.fromEntries(MIX_CLASSES.map((c) => [c, ratePercentText(i.returns[c])])) as Record<MixClass, string>,
  inflation: i.inflation === null ? "" : ratePercentText(i.inflation),
  years: i.years,
});

const RATE_ERROR = "Enter a percent above -100, like 7.5.";
const AMOUNT_ERROR = "Enter an amount like 1,250.50.";

/** "7.5" -> 0.075; null when it is not a percent above -100. */
function rate(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d{1,4}(\.\d{1,4})?$/.test(t)) return null;
  const r = Number(t) / 100;
  return r > -1 ? r : null;
}

type Built = { input: ScenarioInput; errors: null } | { input: null; errors: Record<string, string> };

function build(s: State, base: ScenarioInput): Built {
  const errors: Record<string, string> = {};
  const money = (key: string, text: string) => {
    const v = parseEGP(text);
    if (v === null) errors[key] = AMOUNT_ERROR;
    return v ?? 0;
  };
  const pct = (key: string, text: string) => {
    const v = rate(text);
    if (v === null) errors[key] = RATE_ERROR;
    return v ?? 0;
  };
  const input: ScenarioInput = {
    ...base,
    monthlyIncome: money("income", s.income),
    incomeGrowth: pct("growth", s.growth),
    monthlySpending: money("spending", s.spending),
    monthlySavings: s.savings.trim() === "" ? null : money("savings", s.savings),
    monthlyInvestment: money("investment", s.investment),
    returns: Object.fromEntries(MIX_CLASSES.map((c) => [c, pct(c, s.returns[c])])) as Record<MixClass, number>,
    inflation: s.inflation.trim() === "" ? null : pct("inflation", s.inflation),
    years: s.years,
  };
  return Object.keys(errors).length > 0 ? { input: null, errors } : { input, errors: null };
}

function Num({
  label,
  hint,
  value,
  error,
  onChange,
  placeholder,
  money,
}: {
  label: string;
  hint?: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** An amount of money: dotted out in privacy mode, and selected on focus so typing replaces what the dots hide. */
  money?: boolean;
}) {
  const { hidden } = usePrivacy();
  const masked = money && hidden;
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={masked ? "password" : "text"}
        onFocus={masked ? (e) => e.currentTarget.select() : undefined}
        // Hidden before the page hydrates while privacy mode is on (app/globals.css).
        data-amount={money ? "" : undefined}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={field}
      />
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-sm text-negative">
          {error}
        </span>
      )}
    </Field>
  );
}

function GoalLine({ g }: { g: GoalOutcome }) {
  const completion = g.completionDate === null ? "not reached within 100 years at this pace" : formatMonthYear(g.completionDate);
  const required =
    g.requiredMonthly === null ? (
      "target date has passed"
    ) : g.requiredMonthly === 0 ? (
      "nothing more needed"
    ) : (
      <>
        <Amount value={g.requiredMonthly} /> a month
      </>
    );
  return (
    <li className="px-4 py-3">
      <p className="font-medium">{g.name}</p>
      <p className={`text-sm font-medium ${g.onTrack ? "text-positive" : "text-negative"}`}>
        {g.onTrack ? "✓ On track" : "▲ Behind"}: {monthsLateText(g.monthsLate)}
      </p>
      <dl className="mt-1 space-y-0.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Reached around</dt>
          <dd className="text-right">{completion}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Needed to hit the target date</dt>
          <dd className="text-right">{required}</dd>
        </div>
      </dl>
      {g.adjusted && (
        <div className="mt-3 border-t border-border pt-2 text-sm">
          <p className="font-medium">With inflation (separate from the figures above)</p>
          <p className="text-muted">
            The target grows to <Amount value={g.adjusted.target} /> by its date. {g.adjusted.onTrack ? "✓ On track" : "▲ Behind"}:{" "}
            {monthsLateText(g.adjusted.monthsLate)}. Reached around{" "}
            {g.adjusted.completionDate === null ? "never within 100 years" : formatMonthYear(g.adjusted.completionDate)}.{" "}
            {g.adjusted.requiredMonthly === null ? (
              "Target date has passed."
            ) : g.adjusted.requiredMonthly === 0 ? (
              "Nothing more needed."
            ) : (
              <>
                Needed: <Amount value={g.adjusted.requiredMonthly} /> a month.
              </>
            )}
          </p>
        </div>
      )}
    </li>
  );
}

function Assumptions({ used, input, typedInvestment }: { used: ScenarioResult["used"]; input: ScenarioInput; typedInvestment: number }) {
  const r = used.returns;
  const w = used.investSplit;
  const share = (c: "stocks" | "gold" | "clouds") => `${Math.round(w[c] * 100)}%`;
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
      <li>
        Projection assumes {formatRate(r.stocks)} a year for stocks and funds, {formatRate(r.gold)} for gold, {formatRate(r.clouds)} for
        Savings Clouds and {formatRate(r.cash)} for cash.
      </li>
      <li>
        Your income grows {formatRate(used.incomeGrowth)} a year, once a year. Spending and loans stay the same, and no loan is paid off.
      </li>
      <li>
        Each month you save <Amount value={used.monthlySavings} />
        {input.monthlySavings === null ? " (income minus spending, rising as income grows)" : " (the figure you typed, kept flat)"}.{" "}
        {used.monthlyInvestment > 0 ? (
          <>
            <Amount value={used.monthlyInvestment} /> of it is invested. It is split by today&apos;s mix of what you hold, not by your
            allocation rules (stocks and funds {share("stocks")}, gold {share("gold")}, Savings Clouds {share("clouds")}); the rest
            stays in cash.
          </>
        ) : (
          "None of it is invested; it all stays in cash."
        )}{" "}
        Money lands at the end of each month.
      </li>
      {typedInvestment > used.monthlyInvestment && (
        <li>
          You typed <Amount value={typedInvestment} /> to invest, but only what you save can be invested, so <Amount value={used.monthlyInvestment} />{" "}
          is used.
        </li>
      )}
      {used.monthlySavings < 0 && <li>You spend more than you earn here, so cash is drawn down each month and can go below zero.</li>}
      {used.inflation !== null && (
        <li>
          Prices rise {formatRate(used.inflation)} a year. &quot;Today&apos;s money&quot; figures divide by that, so they show what the amount
          could buy now.
        </li>
      )}
      <li>These are assumptions, not forecasts. Real returns and prices will differ.</li>
    </ul>
  );
}

/** The what-if calculator. Everything runs here in the browser on the figures below; nothing is saved. */
export function ScenarioCalculator({
  initial,
  basis,
  inputsMissing,
  returnsMissing,
  stale,
}: {
  initial: ScenarioInput;
  basis: "average" | "entered";
  inputsMissing: boolean;
  returnsMissing: MixClass[];
  stale: boolean;
}) {
  const [s, setS] = useState(() => start(initial));
  const built = useMemo(() => build(s, initial), [s, initial]);
  const outcome = useMemo(() => {
    if (!built.input) return null;
    try {
      return { result: projectScenario(built.input) };
    } catch (e) {
      return { error: e instanceof RangeError ? e.message : "These figures cannot be projected." };
    }
  }, [built]);
  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));
  const errors = built.errors ?? {};
  const result = outcome && "result" in outcome ? outcome.result : null;
  const last = result?.rows[result.rows.length - 1];
  const { hidden } = usePrivacy();

  return (
    <>
      <section className={`mt-6 p-5 ${card}`}>
        {hidden && (
          <p className="mb-4 text-sm text-muted">
            Amounts are hidden, so the money fields show dots. Tap a field and type to replace what is in it.
          </p>
        )}
        <p className="mb-4 text-sm text-muted">
          {inputsMissing
            ? "You have no history or entered figures yet, so income and spending start at 0. "
            : basis === "average"
              ? "Income and spending start from the average of your last 3 full months. "
              : "Income and spending start from the figures you entered in your plan. "}
          Change anything and the results update. Nothing here is saved.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Num money label="Income a month (EGP)" value={s.income} error={errors.income} onChange={(income) => set({ income })} />
          <Num label="Income growth a year (%)" value={s.growth} error={errors.growth} onChange={(growth) => set({ growth })} />
          <Num money label="Spending a month (EGP)" value={s.spending} error={errors.spending} onChange={(spending) => set({ spending })} />
          <Num
            money
            label="Saving a month (EGP)"
            hint="Leave blank to use income minus spending."
            value={s.savings}
            error={errors.savings}
            onChange={(savings) => set({ savings })}
          />
          <Num
            money
            label="Invested a month (EGP)"
            hint="The part of your saving that is invested."
            value={s.investment}
            error={errors.investment}
            onChange={(investment) => set({ investment })}
          />
          <Num
            label="Inflation a year (%), optional"
            hint="Blank leaves out today's-money figures."
            value={s.inflation}
            error={errors.inflation}
            onChange={(inflation) => set({ inflation })}
          />
        </div>

        <h2 className="mt-6 font-semibold">Expected return a year</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {MIX_CLASSES.map((c) => (
            <Num
              key={c}
              label={`${MIX_LABELS[c]} (%)`}
              value={s.returns[c]}
              error={errors[c]}
              onChange={(v) => set({ returns: { ...s.returns, [c]: v } })}
            />
          ))}
        </div>
        {returnsMissing.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            You have not set an expected return for {returnsMissing.map((c) => MIX_LABELS[c]).join(", ")}; they start at 0%. Set them in{" "}
            <Link href="/more/assumptions" className="underline">
              Assumptions
            </Link>{" "}
            to have them filled in.
          </p>
        )}

        <label className="mt-6 block">
          <span className="text-sm text-muted">Years to look ahead: {s.years}</span>
          <input
            type="range"
            min={1}
            max={40}
            value={s.years}
            onChange={(e) => set({ years: Number(e.target.value) })}
            className="mt-2 block h-11 w-full"
          />
        </label>
        <button type="button" onClick={() => setS(start(initial))} className={`mt-2 ${secondaryBtn}`}>
          Start again from my data
        </button>
      </section>

      {built.errors && (
        <p role="status" className="mt-6 text-negative">
          Fix the highlighted figures to see the results.
        </p>
      )}
      {outcome && "error" in outcome && (
        <p role="alert" className="mt-6 text-negative">
          {outcome.error}
        </p>
      )}

      {result && last && built.input && (
        <>
          <section className={`mt-8 p-5 ${card}`} aria-live="polite">
            <h2 className="text-lg font-semibold tracking-tight">
              In {s.years} {s.years === 1 ? "year" : "years"}
            </h2>
            <p className="mt-1 text-sm text-muted">If these assumptions hold. A calculation, not a promise.</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <dt className="text-sm text-muted">Net worth</dt>
                <dd className="text-xl font-semibold tracking-tight">
                  <Amount value={last.netWorth} />
                </dd>
                <dd className="text-sm text-muted">
                  Today: <Amount value={result.rows[0].netWorth} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Investments</dt>
                <dd className="text-xl font-semibold tracking-tight text-investments">
                  <Amount value={last.investments} />
                </dd>
                <dd className="text-sm text-muted">
                  Today: <Amount value={result.rows[0].investments} />
                </dd>
              </div>
              {last.realNetWorth !== undefined && (
                <div className="col-span-2">
                  <dt className="text-sm text-muted">Net worth in today&apos;s money</dt>
                  <dd className="text-xl font-semibold tracking-tight">
                    <Amount value={last.realNetWorth} />
                  </dd>
                  <dd className="text-sm text-muted">What that net worth could buy at today&apos;s prices, with inflation at {formatRate(built.input.inflation ?? 0)}.</dd>
                </div>
              )}
            </dl>
            {stale && <p className="mt-3 text-sm text-negative">▲ Some investment values you start from are out of date.</p>}
          </section>

          <section className="mt-8">
            <h2 className="mb-2 text-lg font-semibold tracking-tight">Net worth year by year</h2>
            <div className={`p-5 ${card}`}>
              <BarChart
                name="Projected net worth"
                xTitle="Years from now"
                token="foreground"
                bars={result.rows.map((r) => ({ label: r.year === 0 ? "Now" : String(r.year), value: r.netWorth }))}
              />
            </div>
            <div role="region" aria-label="Projected figures by year, scrolls sideways" tabIndex={0} className={`mt-3 overflow-x-auto ${card}`}>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Projected figures by year</caption>
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th scope="col" className="px-4 py-2 font-normal">
                      Year
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-normal">
                      Net worth
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-normal">
                      Investments
                    </th>
                    {last.realNetWorth !== undefined && (
                      <th scope="col" className="px-4 py-2 text-right font-normal">
                        In today&apos;s money
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.rows.map((r) => (
                    <tr key={r.year}>
                      <th scope="row" className="px-4 py-2 font-normal">
                        {r.year === 0 ? "Now" : r.year}
                      </th>
                      <td className="px-4 py-2 text-right">
                        <Amount value={r.netWorth} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Amount value={r.investments} />
                      </td>
                      {r.realNetWorth !== undefined && (
                        <td className="px-4 py-2 text-right">
                          <Amount value={r.realNetWorth} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-2 text-lg font-semibold tracking-tight">Your goals in this scenario</h2>
            {result.goals.length === 0 ? (
              <p className="text-muted">You have no active goals.</p>
            ) : (
              <>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {result.goals.map((g) => (
                    <GoalLine key={g.id} g={g} />
                  ))}
                </ul>
                <p className="mt-2 text-sm text-muted">
                  Each goal keeps the monthly amount from your plan; it does not change when you change your saving here.
                </p>
                {result.goalsExceedSavings && (
                  <p role="status" className="mt-2 text-sm text-negative">
                    ▲ Your goals plan to set aside more each month than you save in this scenario.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-2 text-lg font-semibold tracking-tight">What this assumes</h2>
            <div className={`p-5 ${card}`}>
              <Assumptions used={result.used} input={built.input} typedInvestment={built.input.monthlyInvestment} />
            </div>
          </section>
        </>
      )}
    </>
  );
}
