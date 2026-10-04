import Link from "next/link";
import { Amount } from "./Amount";
import { card } from "./ui";

/** Home card: what the plan says to set aside for goals this month against what has been set aside so far. */
export function GoalPlanCard({
  planned,
  actual,
  hasRules,
  shortfall,
}: {
  planned: number;
  actual: number;
  hasRules: boolean;
  shortfall: number;
}) {
  const diff = actual - planned;
  return (
    <section className={`p-5 ${card}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Monthly plan</h2>
        <Link href="/goals/plan" className="inline-flex min-h-11 items-center text-sm underline">
          See the plan
        </Link>
      </div>
      {planned === 0 && !hasRules ? (
        <p className="text-muted">
          You have no monthly plan yet.{" "}
          <Link href="/goals/rules" className="underline">
            Set up allocation rules
          </Link>
          .
        </p>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-4">
            <div>
              <dt className="text-sm text-muted">Planned for goals</dt>
              <dd className="text-xl font-semibold tracking-tight">
                <Amount value={planned} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Set aside so far</dt>
              <dd className="text-xl font-semibold tracking-tight">
                <Amount value={actual} />
              </dd>
            </div>
          </dl>
          {planned > 0 && (
            <p className="mt-2 text-sm text-muted">
              {diff === 0 ? (
                "You are on your plan."
              ) : (
                <>
                  <Amount value={Math.abs(diff)} /> {diff > 0 ? "above" : "below"} your plan so far.
                </>
              )}
            </p>
          )}
          {hasRules &&
            (shortfall === 0 ? (
              <p className="mt-2 font-semibold text-positive">✓ Monthly plan is fully funded</p>
            ) : (
              <p className="mt-2 font-semibold text-negative">
                ▲ Short by <Amount value={shortfall} /> this month
              </p>
            ))}
        </>
      )}
    </section>
  );
}
