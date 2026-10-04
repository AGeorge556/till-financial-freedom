import type { BudgetStatus } from "@/lib/finance-core/budget";
import { Amount } from "./Amount";
import { card } from "./ui";

const percentOf = (status: BudgetStatus) => Math.round(status.percentUsed * 100);

/** Text, symbol and colour together; never colour alone. */
function state(status: BudgetStatus, ongoing: boolean): { text: string; tone: string; bar: string } {
  if (status.level === "over") return { text: "▲ Over budget", tone: "text-negative", bar: "bg-negative" };
  if (status.level === "alert") return { text: `▲ ${percentOf(status)}% used, at your alert level`, tone: "text-negative", bar: "bg-negative" };
  if (status.level === "warn") return { text: `▲ ${percentOf(status)}% of your budget used`, tone: "text-spending", bar: "bg-spending" };
  if (ongoing && status.projectedOver) return { text: "▲ On track to go over", tone: "text-spending", bar: "bg-positive" };
  return { text: "✓ Within budget", tone: "text-positive", bar: "bg-positive" };
}

export function BudgetBar({ name, status, bar }: { name: string; status: BudgetStatus; bar: string }) {
  const pct = Math.min(100, percentOf(status));
  return (
    <div
      role="progressbar"
      aria-label={`${name} budget used`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${percentOf(status)} percent of the budget used`}
      className="h-2.5 overflow-hidden rounded-full bg-border"
    >
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One budget for one month: spent, left, percent used and, while the month is running, where it is heading. */
export function BudgetCard({ name, status, ongoing, heading = "h3" }: { name: string; status: BudgetStatus; ongoing: boolean; heading?: "h2" | "h3" }) {
  const s = state(status, ongoing);
  const Heading = heading;
  return (
    <div className={`p-4 ${card}`}>
      <div className="flex items-baseline justify-between gap-3">
        <Heading className="min-w-0 truncate font-semibold tracking-tight">{name}</Heading>
        <span className={`shrink-0 text-sm font-medium ${s.tone}`}>{s.text}</span>
      </div>
      <p className="mt-2">
        <Amount value={status.spent} className="text-2xl font-semibold tracking-tight text-spending" />
        <span className="text-muted"> of </span>
        <Amount value={status.budget} className="text-muted" />
        <span className="text-muted"> · {percentOf(status)}% used</span>
      </p>
      <div className="mt-2">
        <BudgetBar name={name} status={status} bar={s.bar} />
      </div>
      <p className="mt-2 text-sm">
        {status.remaining >= 0 ? (
          <>
            <Amount value={status.remaining} /> left
          </>
        ) : (
          <span className="text-negative">
            <Amount value={-status.remaining} /> over
          </span>
        )}
      </p>
      {ongoing && (
        <p className="mt-1 text-sm text-muted">
          On track to spend about <Amount value={status.projected} /> by the end of the month
          {status.projectedOver && status.level !== "over" ? ", which is above your budget" : ""}.
        </p>
      )}
    </div>
  );
}

/** The compact form for Home: spent of the budget, the bar and the state, in a few lines. */
export function BudgetSummary({ status }: { status: BudgetStatus }) {
  const s = state(status, true);
  return (
    <div>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span>
          <Amount value={status.spent} className="font-semibold text-spending" />
          <span className="text-muted"> of </span>
          <Amount value={status.budget} className="text-muted" />
        </span>
        <span className={`text-sm font-medium ${s.tone}`}>{s.text}</span>
      </p>
      <div className="mt-2">
        <BudgetBar name="Monthly" status={status} bar={s.bar} />
      </div>
    </div>
  );
}
