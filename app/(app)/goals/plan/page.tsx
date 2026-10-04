import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { formatRange } from "@/components/dates";
import { formatRate, ruleTargetName } from "@/components/GoalFormat";
import { ClearOverrideButton, OverrideButton } from "@/components/GoalPlanForms";
import { BackLink, card } from "@/components/ui";
import { requireUserId } from "@/lib/auth";
import { loadGoalData } from "../data";

export const metadata: Metadata = { title: "This month's plan" };

export default async function Page() {
  const userId = await requireUserId();
  const data = await loadGoalData(userId);
  const { plan, month } = data;
  const shortRules = data.rules.filter((r) => r.outcome && r.outcome.shortfall > 0);
  const active = data.goals.filter((v) => !v.goal.archivedAt);
  const fundedRules = data.rules.filter((r) => !r.goalArchived);

  return (
    <>
      <BackLink href="/goals">Goals</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">This month&apos;s plan</h1>
      <p className="mt-1 text-muted">{formatRange(month.start, month.end)}</p>

      <section className={`mt-6 p-5 ${card}`}>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          <div>
            <dt className="text-sm text-muted">Income</dt>
            <dd className="font-medium">
              <Amount value={plan.income} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Spending</dt>
            <dd className="font-medium">
              <Amount value={plan.spending} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Available</dt>
            <dd className={`font-medium ${plan.capacity < 0 ? "text-negative" : ""}`}>
              <Amount value={plan.capacity} />
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">
          {plan.basis === "average"
            ? "Based on the average of your last 3 full months."
            : plan.inputsMissing
              ? "You have not entered your expected income and spending yet."
              : "Based on the income and spending you entered. It switches to your 3-month average once you have 3 full months of history."}{" "}
          <Link href="/goals/rules" className="underline">
            Change in allocation rules
          </Link>
        </p>
        <p className="mt-1 text-sm text-muted">
          Your savings target for the month is <Amount value={plan.target} />.
        </p>

        {fundedRules.length > 0 &&
          (shortRules.length === 0 ? (
            <p role="status" className="mt-4 font-semibold text-positive">
              ✓ Monthly plan is fully funded
            </p>
          ) : (
            <div role="status" className="mt-4">
              <p className="font-semibold text-negative">▲ There is not enough to fund everything</p>
              <ul className="mt-1 text-sm">
                {shortRules.map((r) => (
                  <li key={r.rule.id}>
                    {ruleTargetName(r.rule.targetKind, r.goalName)}: short by <Amount value={r.outcome!.shortfall} />
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm text-muted">
                Goals are funded by priority. Percentage and remainder rules get nothing this month.
              </p>
            </div>
          ))}
        {plan.outcome.fixedExceedsTargetBy > 0 && (
          <p role="status" className="mt-2 text-sm text-negative">
            Your fixed amounts exceed your savings target by <Amount value={plan.outcome.fixedExceedsTargetBy} />.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Rules this month</h2>
        {fundedRules.length === 0 ? (
          <p className="text-muted">
            You have no allocation rules.{" "}
            <Link href="/goals/rules" className="underline">
              Add a rule
            </Link>{" "}
            to split your monthly savings between goals.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {fundedRules.map(({ rule, goalName, outcome, overrideAmount }) => (
              <li key={rule.id} className="px-4 py-3">
                <p className="font-medium">{ruleTargetName(rule.targetKind, goalName)}</p>
                <p className="text-sm text-muted">
                  {rule.kind === "fixed" && (
                    <>
                      Fixed: <Amount value={rule.amount ?? 0} /> a month
                    </>
                  )}
                  {rule.kind === "percentage" && `${formatRate(rule.percent ?? 0)} of what is left after fixed amounts`}
                  {rule.kind === "remainder" && "Whatever is left"}
                </p>
                {outcome && (
                  <dl className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-xs text-muted">Planned</dt>
                      <dd className="font-medium">
                        <Amount value={outcome.planned} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Funded</dt>
                      <dd className={`font-medium ${outcome.shortfall > 0 ? "text-negative" : ""}`}>
                        <Amount value={outcome.funded} />
                      </dd>
                    </div>
                  </dl>
                )}
                {outcome && outcome.shortfall > 0 && (
                  <p className="mt-1 text-sm text-negative">
                    ▲ Short by <Amount value={outcome.shortfall} />
                  </p>
                )}
                {overrideAmount !== null && (
                  <p className="mt-1 text-sm text-muted">
                    Changed for this month only (the rule stays as it is).
                  </p>
                )}
                {outcome && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <OverrideButton ruleId={rule.id} month={data.monthKey} planned={outcome.planned} name={ruleTargetName(rule.targetKind, goalName)} />
                    {overrideAmount !== null && <ClearOverrideButton ruleId={rule.id} month={data.monthKey} name={ruleTargetName(rule.targetKind, goalName)} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted">
          Nothing is moved automatically. To act on the plan, set money aside on each goal&apos;s page.
        </p>
      </section>

      {active.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Goal by goal</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {active.map((v) => {
              const diff = v.actual - v.planned;
              return (
                <li key={v.goal.id}>
                  <Link href={`/goals/${v.goal.id}`} className="block min-h-14 px-4 py-3">
                    <span className="block font-medium">{v.goal.name}</span>
                    <span className="mt-1 grid grid-cols-2 gap-3">
                      <span>
                        <span className="block text-xs text-muted">Planned</span>
                        <span className="block font-medium">
                          <Amount value={v.planned} />
                        </span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">Set aside so far</span>
                        <span className="block font-medium">
                          <Amount value={v.actual} />
                        </span>
                      </span>
                    </span>
                    {v.planned > 0 && (
                      <span className="mt-1 block text-sm text-muted">
                        {diff === 0 ? (
                          "On your plan"
                        ) : (
                          <>
                            <Amount value={Math.abs(diff)} /> {diff > 0 ? "above" : "below"} your plan
                          </>
                        )}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
