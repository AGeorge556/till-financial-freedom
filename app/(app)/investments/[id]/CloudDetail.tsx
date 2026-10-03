import { Amount } from "@/components/Amount";
import { CloudConfirmForm, CloudEditForm, CloudFlowForm, CloudRateForm } from "@/components/CloudForms";
import { formatRate } from "@/components/GoalFormat";
import { confirmedText, dateText } from "@/components/HoldingFormat";
import { HoldingArchiveButton, HoldingEditForm } from "@/components/HoldingForms";
import { HoldingHistory } from "@/components/HoldingHistory";
import { Panel, Row, StaleBadge } from "@/components/HoldingParts";
import { HoldingPL } from "@/components/HoldingPL";
import type { AccountOption } from "@/components/TransactionForm";
import { BackLink, card } from "@/components/ui";
import type { CloudView, HistoryEntry } from "../data";

const monthsText = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

/** A Savings Cloud: every value is an estimate from the entered APY until the user confirms the actual value. */
export function CloudDetail({
  view,
  accountName,
  cashAccounts,
  today,
  history,
}: {
  view: CloudView;
  accountName: string;
  cashAccounts: AccountOption[];
  today: string;
  history: HistoryEntry[];
}) {
  const { row, est, rate, projection } = view;
  const archived = row.archivedAt !== null;
  const every = row.contributionFrequency === "weekly" ? "a week" : "a month";

  return (
    <>
      <BackLink href="/investments">Investments</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">{row.name}</h1>
      <p className="mt-1 text-muted">
        Savings Cloud · Held in {accountName}
        {row.startDate ? ` · Started ${dateText(row.startDate)}` : ""}
        {row.maturityDate ? ` · Matures ${dateText(row.maturityDate)}` : ""}
        {archived ? " · Archived" : ""}
      </p>
      {row.notes && <p className="mt-2">{row.notes}</p>}

      <section className={`mt-6 p-5 ${card}`}>
        <p className="text-sm text-muted">Current value</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <Amount value={est.value} showPiasters className="text-4xl font-semibold tracking-tight text-investments" />
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">{est.label}</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          {est.label === "confirmed"
            ? "This is the value you confirmed today."
            : est.anchorDate
              ? `Estimated: grown from the value you confirmed on ${dateText(est.anchorDate)}, plus what you moved since, at the yearly rate you entered.`
              : "Estimated from your deposits and the yearly rate you entered. Confirm the actual value to give it a starting point."}
        </p>
        <p className="mt-1 text-sm text-muted">
          {confirmedText(est.days)}
          {est.stale && <StaleBadge />}
        </p>
        <dl className="mt-3 divide-y divide-border border-t border-border">
          <Row label="Deposited minus withdrawn" hint="Your cost basis">
            <Amount value={est.basis} showPiasters />
          </Row>
          <Row label="Growth so far (estimated)" hint="Market change, not income">
            <HoldingPL value={est.growth} showPiasters />
          </Row>
          <Row
            label="Yearly rate (APY)"
            hint={
              rate
                ? `Since ${dateText(rate.date)}. Growth is added on top of growth through the year.`
                : "Not set. No growth is assumed until you enter one."
            }
          >
            {rate ? formatRate(rate.apy) : "–"}
          </Row>
          {row.contributionAmount !== null && (
            <Row label="Planned contribution" hint="Only used for the expected value below. Nothing is booked.">
              <Amount value={row.contributionAmount} showPiasters /> {every}
            </Row>
          )}
        </dl>
      </section>

      {projection && (
        <section className={`mt-6 p-5 ${card}`}>
          <h2 className="text-lg font-semibold tracking-tight">Expected value (an assumption)</h2>
          <dl className="mt-2 divide-y divide-border">
            <Row label="In 12 months">
              <Amount value={projection.in12Months} />
            </Row>
            {projection.atMaturity && row.maturityDate && (
              <Row label={`At maturity, ${dateText(row.maturityDate)}`} hint={`About ${monthsText(projection.atMaturity.months)} from now`}>
                <Amount value={projection.atMaturity.projected} />
              </Row>
            )}
          </dl>
          <p className="mt-3 text-sm text-muted">
            Expected, not guaranteed. It assumes {rate ? `today's rate of ${formatRate(rate.apy)}` : "no growth, because no rate is set"} stays the same
            {projection.monthlyContribution > 0 ? ", and that you keep adding your planned contribution (weekly ones count as 52 weeks a year)" : ""}.
          </p>
        </section>
      )}

      {archived ? (
        <p className="mt-6 text-muted">This cloud is archived. Restore it to record anything new.</p>
      ) : (
        <section className="mt-6 space-y-3">
          <h2 className="sr-only">Record something</h2>
          <Panel title="Deposit" hint="Money you put into the cloud.">
            <CloudFlowForm side="deposit" holdingId={row.id} accountId={row.accountId} accounts={cashAccounts} today={today} />
          </Panel>
          <Panel title="Withdraw" hint="Money you took out of the cloud.">
            <CloudFlowForm side="withdraw" holdingId={row.id} accountId={row.accountId} accounts={cashAccounts} today={today} />
          </Panel>
          <Panel title="Rate change" hint="The provider changed the yearly rate, or you are entering it for the first time. Older rates stay in the history.">
            <CloudRateForm holdingId={row.id} today={today} />
          </Panel>
          <Panel title="Confirm actual value" hint="Check the value in the provider's app and type it here. It replaces the estimate as the starting point.">
            <CloudConfirmForm holdingId={row.id} today={today} />
          </Panel>
          <Panel title="Dates and planned contribution">
            <CloudEditForm
              holdingId={row.id}
              startDate={row.startDate}
              maturityDate={row.maturityDate}
              contributionAmount={row.contributionAmount}
              contributionFrequency={row.contributionFrequency}
            />
          </Panel>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">History</h2>
        <HoldingHistory entries={history} />
        <p className="mt-2 text-sm text-muted">Voided entries are left out here. Rates and confirmed values are never edited.</p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Details</h2>
        <div className={`p-5 ${card}`}>
          <HoldingEditForm id={row.id} name={row.name} notes={row.notes} />
        </div>
      </section>

      <section className="mt-8">
        <HoldingArchiveButton id={row.id} archived={archived} canArchive={est.value === 0} />
        <p className="mt-2 text-sm text-muted">
          {est.value === 0
            ? "An archived cloud leaves your lists. Its history stays."
            : "You can archive a cloud once its value is 0: withdraw the rest, or confirm its value as zero."}
        </p>
      </section>
    </>
  );
}
