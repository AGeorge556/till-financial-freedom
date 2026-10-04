import Link from "next/link";
import type { ReactNode } from "react";
import type { GoalView } from "@/app/(app)/goals/data";
import { Amount } from "./Amount";
import { formatMonthYear } from "./dates";
import { monthsLateText, monthsText, progressPercent } from "./GoalFormat";
import { card } from "./ui";

export function GoalProgressBar({ view }: { view: GoalView }) {
  const pct = progressPercent(view.current, view.goal.targetAmount);
  return (
    <div
      role="progressbar"
      aria-label={`${view.goal.name} progress`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct} percent of the target`}
      className="h-2.5 overflow-hidden rounded-full bg-border"
    >
      <div className="h-full rounded-full bg-goals" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The target month moved by the months the plan runs early (negative) or late: when the goal is reached at this pace. */
function finishMonth(targetDate: string, monthsLate: number): string {
  const [y, m] = targetDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + monthsLate, 1));
  return formatMonthYear(shifted.toISOString().slice(0, 10));
}

/** Text plus colour plus a symbol, never colour alone. */
export function GoalStatusLine({ view, compact }: { view: GoalView; compact?: boolean }) {
  const { goal, current, projection: p } = view;
  const date = formatMonthYear(goal.targetDate);
  let tone = "text-negative";
  let head: string;
  let detail: ReactNode = null;

  if (current >= goal.targetAmount) {
    tone = "text-positive";
    head = "✓ Goal reached";
  } else if (p.required === "target-date-passed") {
    head = "✕ Target date has passed";
    detail = (
      <>
        Still <Amount value={goal.targetAmount - current} /> short.
      </>
    );
  } else if (p.onTrack) {
    tone = "text-positive";
    head = "✓ On track";
    detail = (
      <>
        Projected <Amount value={p.gap} /> above your target by {date}
        {p.monthsLate !== null && `, ${monthsLateText(p.monthsLate)}`}.
        {p.monthsLate !== null && ` At this pace you reach it in ${finishMonth(goal.targetDate, p.monthsLate)}.`}
      </>
    );
  } else {
    head = "▲ Behind";
    detail = (
      <>
        Projected <Amount value={-p.gap} /> short of your target by {date}
        {p.monthsLate === null
          ? ", and not reached at this pace."
          : `, ${monthsLateText(p.monthsLate)}. At this pace you reach it in ${finishMonth(goal.targetDate, p.monthsLate)}.`}
      </>
    );
  }

  return (
    <p className={compact ? "text-sm" : "mt-3"}>
      <span className={`font-semibold ${tone}`}>{head}</span>
      {detail && !compact && <span className="block text-sm text-muted">{detail}</span>}
    </p>
  );
}

export function GoalBadges({ view }: { view: GoalView }) {
  const pill = "rounded-full border border-border px-2 py-0.5 text-xs font-normal";
  return (
    <>
      {view.currentSource === "manual" && <span className={`${pill} text-muted`}>manual</span>}
      {view.target.mode === "expense_months" && (
        <span className={`${pill} text-muted`}>{monthsText(view.target.months)} of essentials</span>
      )}
      {view.overAllocatedBy > 0 && (
        <span className={`${pill} text-negative`}>
          over-allocated by <Amount value={view.overAllocatedBy} />
        </span>
      )}
    </>
  );
}

/** How an "expense_months" goal's target was worked out, and from how many months of history. Nothing for a fixed target. */
export function GoalTargetNote({ view }: { view: GoalView }) {
  const t = view.target;
  if (t.mode !== "expense_months") return null;
  if (t.calc.kind === "target") {
    const used = t.calc.monthsUsed;
    return (
      <p className="mt-3 text-sm text-muted">
        Target = {monthsText(t.months)} of essential spending. Your essential spending averages{" "}
        <Amount value={t.calc.monthlyEssential} /> a month over your last {monthsText(used)} of history
        {used < 6 ? " (up to 6 full months are used, so it firms up as months pass)" : ""}. It is recalculated each time you open
        this page.
      </p>
    );
  }
  return (
    <p role="status" className="mt-3 text-sm text-negative">
      {t.calc.reason === "no-history"
        ? "There is not yet one full month of history to work out this target."
        : "Your essential categories show no spending in the last full months, so the target cannot be worked out."}{" "}
      For now the target is your fixed amount of <Amount value={t.stored} />.{" "}
      {t.calc.reason === "no-essential-spending" && (
        <>
          Mark your needs as essential in{" "}
          <Link href="/more/categories" className="underline">
            Categories
          </Link>
          .
        </>
      )}
    </p>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/** The figures shared by the list card and the detail page. */
export function GoalFigures({ view }: { view: GoalView }) {
  const { goal, projection: p, planned, actual } = view;
  const diff = actual - planned;
  return (
    <dl className="mt-3 divide-y divide-border border-t border-border">
      <Row label="Monthly amount needed to reach your goal">
        {p.required === "target-date-passed" ? (
          "Target date has passed"
        ) : p.required === 0 ? (
          "Nothing more needed"
        ) : (
          <Amount value={p.required} />
        )}
      </Row>
      <Row label="Planned each month">
        {planned === 0 ? (
          "Nothing planned"
        ) : (
          <>
            <Amount value={planned} />
            <span className="block text-xs font-normal text-muted">
              {view.plannedSource === "rules" ? "from your allocation rules" : "this goal's own plan"}
            </span>
          </>
        )}
      </Row>
      <Row label="Set aside this month">
        <Amount value={actual} />
        <span className="block text-xs font-normal text-muted">
          {planned === 0 ? null : diff === 0 ? (
            "on your plan"
          ) : (
            <>
              <Amount value={Math.abs(diff)} /> {diff > 0 ? "above" : "below"} your plan
            </>
          )}
        </span>
      </Row>
      <Row label="Target date">
        {formatMonthYear(goal.targetDate)}
        <span className="block text-xs font-normal text-muted">{monthsText(p.monthsRemaining)} of saving left</span>
      </Row>
    </dl>
  );
}

/** `heading` is the level of the goal's name: h3 under a section heading (Home), h2 straight under the page title (Goals). */
export function GoalCard({ view, compact, heading = "h3" }: { view: GoalView; compact?: boolean; heading?: "h2" | "h3" }) {
  const { goal, current } = view;
  const Heading = heading;
  return (
    <article className={`relative p-5 ${card}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Heading dir="auto" className="text-lg font-semibold tracking-tight">
          <Link
            href={`/goals/${goal.id}`}
            className="inline-flex min-h-11 items-center after:absolute after:inset-0 after:rounded-2xl"
          >
            {goal.name}
          </Link>
        </Heading>
        <GoalBadges view={view} />
      </div>
      {!compact && <p className="text-sm text-muted">Priority {goal.priority}</p>}
      <p className="mt-1">
        <Amount value={current} className="text-xl font-semibold" />
        <span className="text-muted"> of </span>
        <Amount value={goal.targetAmount} className="text-muted" />
      </p>
      <div className="mt-3">
        <GoalProgressBar view={view} />
      </div>
      <GoalStatusLine view={view} compact={compact} />
      {!compact && <GoalFigures view={view} />}
    </article>
  );
}
