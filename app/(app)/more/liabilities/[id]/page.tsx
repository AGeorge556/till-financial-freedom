import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Amount } from "@/components/Amount";
import { ratePercentText } from "@/components/GoalFormat";
import { dateText } from "@/components/HoldingFormat";
import { Panel, Row } from "@/components/HoldingParts";
import { EditLoanForm, LiabilityArchiveButton, LiabilityUpdateForm, PaymentForm } from "@/components/LiabilityForms";
import { LiabilityHistory } from "@/components/LiabilityHistory";
import { BackLink, card } from "@/components/ui";
import { listAccounts, listCategories, loadRemovedRecords, toLedgerTx } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { periodSummary } from "@/lib/finance-core/ledger";
import { cairoToday } from "@/lib/finance-core/time";
import { liabilityHistory, loadLiabilities } from "../data";

export const metadata: Metadata = { title: "Loan" };

// Postgres throws on a malformed uuid, so reject those before querying.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_LABEL = { loan: "Loan", owed: "Money owed", other: "Other" } as const;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [{ views }, accounts, categories, removed] = await Promise.all([
    loadLiabilities(userId),
    listAccounts(userId, { includeArchived: true }),
    listCategories(userId, { includeArchived: true }),
    loadRemovedRecords(userId),
  ]);
  const loan = views.find((l) => l.id === id);
  if (!loan) notFound();
  const archived = loan.archivedAt !== null;
  const today = cairoToday();
  // Principal and interest paid so far, from the engine (posted rows only).
  const paid = periodSummary(loan.transactions.map(toLedgerTx));
  // Archived accounts and categories stay in the list, flagged: a saved payment may use one, and the form keeps only that one.
  const payFrom = accounts
    .filter((a) => a.type !== "credit_card" && a.type !== "receivable")
    .map((a) => ({ id: a.id, name: a.name, archived: a.archivedAt !== null }));
  const expenseCategories = categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: c.archivedAt !== null }));

  return (
    <>
      <BackLink href="/more/liabilities">Loans</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">{loan.name}</h1>
      <p className="mt-1 text-muted">
        {KIND_LABEL[loan.kind]} · Since {dateText(loan.startDate)}
        {archived ? " · Paid off" : ""}
      </p>
      {loan.notes && <p className="mt-2">{loan.notes}</p>}

      <section className={`mt-6 p-5 ${card}`}>
        <p className="text-sm text-muted">Outstanding</p>
        <Amount value={loan.outstanding} showPiasters className="mt-1 block text-4xl font-semibold tracking-tight" />
        <dl className="mt-3 divide-y divide-border border-t border-border">
          <Row label="You owed at the start">
            <Amount value={loan.openingBalance} showPiasters />
          </Row>
          <Row label="Principal paid so far" hint="Reduces the loan, not spending">
            <Amount value={paid.liabilityPrincipalPaid} showPiasters />
          </Row>
          <Row label="Interest paid so far" hint="Counted as spending">
            <Amount value={paid.spending} showPiasters />
          </Row>
          <Row label="Interest rate" hint="For your reference only, nothing is calculated from it">
            {loan.interestRate === null ? "Not noted" : `${ratePercentText(loan.interestRate)}% a year`}
          </Row>
        </dl>
      </section>

      {archived ? (
        <p className="mt-6 text-muted">This loan is paid off and archived. Restore it to record anything new.</p>
      ) : (
        <section className="mt-6 space-y-3">
          <h2 className="sr-only">Record something</h2>
          <Panel title="Record a payment">
            <PaymentForm liabilityId={loan.id} accounts={payFrom} categories={expenseCategories} today={today} />
          </Panel>
          <Panel title="Owe more, or correct the balance" hint="For changes that move no cash, like borrowing more or fixing a mistake.">
            <LiabilityUpdateForm liabilityId={loan.id} today={today} />
          </Panel>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">History</h2>
        <LiabilityHistory
          entries={liabilityHistory(loan, removed.liabilityUpdates)}
          liabilityId={loan.id}
          accounts={payFrom}
          categories={expenseCategories}
          today={today}
        />
        <p className="mt-2 text-sm text-muted">
          Tap an entry to correct or remove it. A removed entry stops counting but stays in your history: use Show removed.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Details</h2>
        <div className={`p-5 ${card}`}>
          <EditLoanForm
            id={loan.id}
            name={loan.name}
            kind={loan.kind}
            interestRate={loan.interestRate}
            openingBalance={loan.openingBalance}
            startDate={loan.startDate}
            notes={loan.notes}
          />
        </div>
      </section>

      <section className="mt-8">
        <LiabilityArchiveButton id={loan.id} archived={archived} canArchive={loan.outstanding === 0} />
        <p className="mt-2 text-sm text-muted">
          {loan.outstanding === 0
            ? "An archived loan leaves your list. Its history stays."
            : "You can archive a loan once nothing is outstanding."}
        </p>
      </section>
    </>
  );
}
