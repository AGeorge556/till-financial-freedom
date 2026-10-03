import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Amount } from "@/components/Amount";
import { formatDay, formatMonthYear } from "@/components/dates";
import { GoalBadges, GoalFigures, GoalProgressBar, GoalStatusLine } from "@/components/GoalCard";
import { formatRate, sharePercentText } from "@/components/GoalFormat";
import { AllocationForm, ArchiveGoalButton, EditGoalButton, HoldingShareForm } from "@/components/GoalForms";
import { KIND_LABEL } from "@/components/HoldingFormat";
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
  const cashSources = view.allocations.flatMap((a) => (a.kind === "cash" ? [a] : []));
  const holdingSources = view.allocations.flatMap((a) => (a.kind === "holding" ? [a] : []));
  const heldOn = new Set(cashSources.map((a) => a.accountId));
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
      current: cashSources.find((x) => x.accountId === a.id)?.amount ?? 0,
      free: a.free,
    }));

  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const holdingName = new Map(data.holdings.map((h) => [h.id, h.name]));
  // A holding stays reachable while this goal still holds a share of it, even archived, so the share can be released.
  const shareChoices = data.holdings
    .map((h) => ({
      ...h,
      current: holdingSources.find((x) => x.holdingId === h.id)?.percent ?? "0",
    }))
    .filter((h) => !h.archived || h.current !== "0");
  const history = data.events.filter((e) => e.goalId === id).slice(0, 10);

  const returnLine =
    view.rateSource === "override"
      ? `Projection assumes ${formatRate(view.rate)} a year (your override)`
      : view.allocations.length === 0
        ? `Projection assumes ${formatRate(view.rate)} a year (nothing linked yet)`
        : `Projection assumes ${formatRate(view.rate)} a year (blended from your funding sources, weighted by their value)`;

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
          {view.returnsMissing.length > 0 &&
            `You have not set a return for ${view.returnsMissing.join(" and ")}, so ${view.returnsMissing.length > 1 ? "they count" : "it counts"} as 0%. `}
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
              ? "Nothing is linked, so the amount above is the manual figure you entered."
              : "Nothing is linked yet."}{" "}
            Set money aside, or take a share of a holding, below.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {view.allocations.map((a) =>
              a.kind === "cash" ? (
                <li key={`cash-${a.accountId}`} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {a.accountName}
                      {a.accountArchived ? " (archived)" : ""}
                    </span>
                    <span className="block text-sm text-muted">
                      Free: <Amount value={a.free} />
                    </span>
                    <span className="block text-sm text-muted">Assumed return: {a.rate === null ? "not set (counts as 0%)" : `${formatRate(a.rate)} a year`}</span>
                    {a.over > 0 && (
                      <span className="block text-sm text-negative">
                        Over-allocated by <Amount value={a.over} />. Nothing was moved; you decide what to do.
                      </span>
                    )}
                  </span>
                  <Amount value={a.amount} className="shrink-0 font-medium" />
                </li>
              ) : (
                <li key={`holding-${a.holdingId}`} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {a.name}
                      {a.archived ? " (archived)" : ""}
                    </span>
                    <span className="block text-sm text-muted">
                      {KIND_LABEL[a.holdingKind]} · {sharePercentText(a.percent)}% of a holding worth <Amount value={a.holdingValue} />
                    </span>
                    <span className="block text-sm text-muted">Free share: {sharePercentText(a.freeShare)}% not claimed by any goal</span>
                    <span className="block text-sm text-muted">
                      Assumed return: {a.rate === null ? "not set (counts as 0%)" : `${formatRate(a.rate)} a year`}
                    </span>
                  </span>
                  <Amount value={a.value} className="shrink-0 font-medium" />
                </li>
              ),
            )}
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
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Fund from a holding</h2>
        <div className={`p-5 ${card}`}>
          <HoldingShareForm
            goalId={goal.id}
            holdings={shareChoices.map((h) => ({
              id: h.id,
              name: h.name,
              kind: h.kind,
              archived: h.archived,
              value: h.value,
              current: h.current,
              freeShare: h.freeShare,
            }))}
          />
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
          <p className="text-muted">Nothing has been set aside for this goal yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {history.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{e.delta > 0 ? "Set aside" : "Released"}</span>
                  <span className="block truncate text-sm text-muted">
                    {formatDay(e.date)} ·{" "}
                    {e.holdingId
                      ? `${e.percentDelta ? `${sharePercentText(e.percentDelta.replace("-", ""))}% of ` : ""}${holdingName.get(e.holdingId) ?? "Unknown holding"}`
                      : (accountName.get(e.accountId!) ?? "Unknown account")}
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
