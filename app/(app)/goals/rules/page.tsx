import type { Metadata } from "next";
import { Amount } from "@/components/Amount";
import { formatRate, ruleTargetName } from "@/components/GoalFormat";
import { DeleteRuleButton, ExpectedMonthlyButton, RuleButton, SavingsTargetButton } from "@/components/GoalPlanForms";
import { BackLink, card } from "@/components/ui";
import { requireUserId } from "@/lib/auth";
import { loadGoalData } from "../data";

export const metadata: Metadata = { title: "Allocation rules" };

export default async function Page() {
  const userId = await requireUserId();
  const data = await loadGoalData(userId);
  const { plan, settings } = data;
  const goalOptions = data.goals.map((v) => ({ id: v.goal.id, name: v.goal.name, archived: v.goal.archivedAt !== null }));

  return (
    <>
      <BackLink href="/goals">Goals</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Allocation rules</h1>
      <p className="mt-1 text-muted">
        Rules decide how your monthly savings are split between goals. They never move money; you set money aside on
        each goal&apos;s page.
      </p>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Savings target</h2>
        <div className={`p-5 ${card}`}>
          <p>
            {settings.savingsTargetMode === "fixed" && (
              <>
                Save <Amount value={settings.savingsTargetAmount ?? 0} className="font-semibold" /> each month.
              </>
            )}
            {settings.savingsTargetMode === "percentage" && (
              <>
                Save {formatRate(settings.savingsTargetPercent ?? 0)} of your income each month, which is{" "}
                <Amount value={plan.target} className="font-semibold" />.
              </>
            )}
            {settings.savingsTargetMode === "flexible" && (
              <>Flexible: the rules share whatever is left after spending, currently <Amount value={plan.target} className="font-semibold" />.</>
            )}
          </p>
          <div className="mt-4">
            <SavingsTargetButton
              mode={settings.savingsTargetMode}
              amount={settings.savingsTargetAmount}
              percent={settings.savingsTargetPercent}
            />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Income and spending</h2>
        <div className={`p-5 ${card}`}>
          <p className="text-sm text-muted">
            {plan.basis === "average"
              ? "Your plan uses the average of your last 3 full months, because you have that much history. The figures you entered are not used now."
              : plan.inputsMissing
                ? "Enter your expected income and spending so the plan has something to work with. You have fewer than 3 full months of history."
                : "Your plan uses the figures you entered, because you have fewer than 3 full months of history. It switches to the average of your actual months once you do."}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-3">
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
              <dt className="text-sm text-muted">Left each month</dt>
              <dd className={`font-medium ${plan.capacity < 0 ? "text-negative" : ""}`}>
                <Amount value={plan.capacity} />
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <ExpectedMonthlyButton income={settings.expectedMonthlyIncome} spending={settings.expectedMonthlySpending} />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Your rules</h2>
          <RuleButton goals={goalOptions} />
        </div>
        <p className="mb-3 text-sm text-muted">
          Fixed amounts are paid first, highest-priority goal first. Percentages then take a share of what is left, and
          one rule can take the remainder.
        </p>

        {data.rules.length === 0 ? (
          <p className="text-muted">
            No rules yet. Add one to see how your monthly savings would be split, or set a monthly plan on each goal.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {data.rules.map(({ rule, goalName, goalArchived, outcome }) => (
              <li key={rule.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-medium">{ruleTargetName(rule.targetKind, goalName)}</span>
                    <span className="block text-sm text-muted">
                      {rule.kind === "fixed" && (
                        <>
                          Fixed: <Amount value={rule.amount ?? 0} /> a month
                        </>
                      )}
                      {rule.kind === "percentage" && `${formatRate(rule.percent ?? 0)} of what is left after fixed amounts`}
                      {rule.kind === "remainder" && "Whatever is left"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {outcome ? (
                      <>
                        <Amount value={outcome.funded} className="font-medium" />
                        <span className="block text-xs text-muted">funded this month</span>
                      </>
                    ) : (
                      <span className="text-sm text-muted">Not funded</span>
                    )}
                  </span>
                </div>
                {goalArchived && <p className="mt-1 text-sm text-muted">This goal is archived, so the rule is not funded.</p>}
                {outcome && outcome.shortfall > 0 && (
                  <p className="mt-1 text-sm text-negative">
                    Short by <Amount value={outcome.shortfall} /> this month.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <RuleButton
                    goals={goalOptions}
                    rule={{
                      id: rule.id,
                      kind: rule.kind,
                      targetKind: rule.targetKind,
                      goalId: rule.goalId,
                      amount: rule.amount,
                      percent: rule.percent,
                    }}
                  />
                  <DeleteRuleButton id={rule.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.rules.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">This month, as calculated</h2>
          <div className={`p-5 ${card}`}>
            <dl className="space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Left after spending</dt>
                <dd className="font-medium">
                  <Amount value={Math.max(0, plan.capacity)} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Your savings target</dt>
                <dd className="font-medium">
                  <Amount value={plan.target} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Shared out by your rules</dt>
                <dd className="font-medium">
                  <Amount value={plan.outcome.distributed} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Not given to any rule</dt>
                <dd className="font-medium">
                  <Amount value={plan.outcome.unallocated} />
                </dd>
              </div>
            </dl>
            {plan.outcome.fixedExceedsTargetBy > 0 && (
              <p role="status" className="mt-3 text-negative">
                Your fixed amounts exceed your savings target by <Amount value={plan.outcome.fixedExceedsTargetBy} />.
              </p>
            )}
            {plan.shortfallTotal > 0 && (
              <p role="status" className="mt-3 text-negative">
                There is not enough to pay every fixed amount, so goals are funded by priority and the rest get less.
                Percentage and remainder rules get nothing this month.
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}
