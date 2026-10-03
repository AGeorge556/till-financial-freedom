import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Amount } from "@/components/Amount";
import { formatDay, formatMonthYear } from "@/components/dates";
import { GoalBadges, GoalFigures, GoalProgressBar, GoalStatusLine } from "@/components/GoalCard";
import { formatRate } from "@/components/GoalFormat";
import { AllocationForm, ArchiveGoalButton, EditGoalButton } from "@/components/GoalForms";
import { GoalWhatIf } from "@/components/GoalWhatIf";
import { BackLink, card } from "@/components/ui";
import { requireUserId } from "@/lib/auth";
import { loadGoalData } from "../data";

export const metadata: Metadata = { title: "Goal" };

// Postgres throws on a malformed uuid, so reject those before querying.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const data = await loadGoalData(userId);
  const view = data.goals.find((v) => v.goal.id === id);
  if (!view) notFound();
  const { goal, projection: p } = view;
  const archived = goal.archivedAt !== null;

  // Cash accounts only; a goal's existing earmark stays reachable even on an archived account, so it can be released.
  const heldOn = new Set(view.allocations.map((a) => a.accountId));
  const choices = data.accounts
    .filter(
      (a) =>
        !a.isInvestment &&
        a.type !== "credit_card" &&
        a.type !== "receivable" &&
        (!a.archived || heldOn.has(a.id)),
    )
    .map((a) => ({
      id: a.id,
      name: a.name,
      archived: a.archived,
      current: view.allocations.find((x) => x.accountId === a.id)?.amount ?? 0,
      free: a.free,
    }));

  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const history = data.events.filter((e) => e.goalId === id).slice(0, 10);

  const returnLine =
    view.rateSource === "override"
      ? `Projection assumes ${formatRate(view.rate)} a year (your override)`
      : view.allocations.length === 0
        ? `Projection assumes ${formatRate(view.rate)} a year (no linked accounts yet)`
        : `Projection assumes ${formatRate(view.rate)} a year (blended from linked accounts)`;

  return (
    <>
      <BackLink href="/goals">Goals</BackLink>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{goal.name}</h1>
        <GoalBadges view={view} />
      </div>
      <p className="mt-1 text-muted">
        Priority {goal.priority} · Target date {formatMonthYear(goal.targetDate)}
        {archived ? " · Archived" : ""}
      </p>
      {goal.notes && <p className="mt-2">{goal.notes}</p>}

      <section className={`mt-6 p-5 ${card}`}>
        <p>
          <Amount value={view.current} className="text-3xl font-semibold tracking-tight" />
          <span className="text-muted"> of </span>
          <Amount value={goal.targetAmount} className="text-muted" />
        </p>
        <div className="mt-3">
          <GoalProgressBar view={view} />
        </div>
        <GoalStatusLine view={view} />
        <GoalFigures view={view} />
        <p className="mt-3 text-sm text-muted">
          {returnLine}.{" "}
          {view.cashReturnMissing && "You have not set a return for cash, so linked accounts count as 0%. "}
          Projections are assumptions, not guarantees.
        </p>
        {view.ruleShortfall > 0 && (
          <p role="status" className="mt-2 text-sm text-negative">
            Your allocation rules cannot fully fund this goal this month.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Where the money comes from</h2>
        {view.allocations.length === 0 ? (
          <p className="text-muted">
            {view.currentSource === "manual"
              ? "No account is linked, so the amount above is the manual figure you entered."
              : "No account is linked yet."}{" "}
            Set money aside below to link one.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {view.allocations.map((a) => (
              <li key={a.accountId} className="flex items-start justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {a.accountName}
                    {a.accountArchived ? " (archived)" : ""}
                  </span>
                  <span className="block text-sm text-muted">
                    Free: <Amount value={a.free} />
                  </span>
                  {a.over > 0 && (
                    <span className="block text-sm text-negative">
                      Over-allocated by <Amount value={a.over} />. Nothing was moved; you decide what to do.
                    </span>
                  )}
                </span>
                <Amount value={a.amount} className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Add or change allocation</h2>
        <div className={`p-5 ${card}`}>
          <AllocationForm goalId={goal.id} accounts={choices} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">What if?</h2>
        <div className={`p-5 ${card}`}>
          <GoalWhatIf
            target={goal.targetAmount}
            current={view.current}
            plannedMonthly={view.planned}
            annualReturn={view.rate}
            monthsRemaining={p.monthsRemaining}
            targetDate={goal.targetDate}
            today={data.today}
            startDay={data.startDay}
            contributedThisMonth={view.actual > 0}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Recent changes</h2>
        {history.length === 0 ? (
          <p className="text-muted">No money has been set aside for this goal yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {history.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{e.delta > 0 ? "Set aside" : "Released"}</span>
                  <span className="block truncate text-sm text-muted">
                    {formatDay(e.date)} · {accountName.get(e.accountId) ?? "Unknown account"}
                  </span>
                </span>
                <span className={`shrink-0 font-medium ${e.delta > 0 ? "text-positive" : "text-muted"}`}>
                  {e.delta > 0 ? "+" : "−"}
                  <Amount value={Math.abs(e.delta)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 space-y-3">
        <EditGoalButton
          goal={{
            id: goal.id,
            name: goal.name,
            targetAmount: goal.targetAmount,
            targetDate: goal.targetDate,
            startDate: goal.startDate,
            priority: goal.priority,
            plannedMonthly: goal.plannedMonthly,
            expectedReturnOverride: goal.expectedReturnOverride,
            manualCurrent: goal.manualCurrent,
            notes: goal.notes,
            color: goal.color,
            icon: goal.icon,
          }}
          hasAllocations={view.allocations.length > 0}
        />
        <ArchiveGoalButton id={goal.id} archived={archived} />
        <p className="text-sm text-muted">
          Archived goals leave your lists and plans, but keep their earmarked money until you release it.
        </p>
      </section>
    </>
  );
}
