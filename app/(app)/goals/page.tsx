import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { GoalCard } from "@/components/GoalCard";
import { NewGoalButton } from "@/components/GoalForms";
import { requireUserId } from "@/lib/auth";
import { loadGoalData } from "./data";

export const metadata: Metadata = { title: "Goals" };

const link = "inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium";

export default async function Page() {
  const userId = await requireUserId();
  const data = await loadGoalData(userId);
  const active = data.goals.filter((v) => !v.goal.archivedAt);
  const archived = data.goals.filter((v) => v.goal.archivedAt);
  const nextPriority = Math.max(0, ...active.map((v) => v.goal.priority)) + 1;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Goals</h1>
        <NewGoalButton nextPriority={nextPriority} />
      </div>

      <nav aria-label="Goal planning" className="mt-4 flex flex-wrap gap-2">
        <Link href="/goals/plan" className={link}>
          This month&apos;s plan
        </Link>
        <Link href="/goals/rules" className={link}>
          Allocation rules
        </Link>
      </nav>

      <div className="mt-6">
        {active.length === 0 ? (
          <EmptyState accent="goals" title="No goals yet" items={["Targets", "Progress", "Monthly plan"]}>
            A goal sets money aside for something you want, like an emergency fund. Add your first goal to see how much
            you need to save each month.
          </EmptyState>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">
              A goal does not hold money. It earmarks part of what is already in your accounts. Projections are
              assumptions, not guarantees.
            </p>
            <ul className="grid gap-4 md:grid-cols-2">
              {active.map((v) => (
                <li key={v.goal.id}>
                  <GoalCard view={v} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Archived</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {archived.map((v) => (
              <li key={v.goal.id}>
                <Link href={`/goals/${v.goal.id}`} className="flex min-h-14 items-center px-4 py-2 text-muted">
                  {v.goal.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
