import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ACCOUNT_TYPE_LABEL } from "@/components/accountTypes";
import { Amount } from "@/components/Amount";
import { BackLink, card } from "@/components/ui";
import { accountBalances, listAccounts, listTransactions } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { ArchiveButton, EditAccountForm, SetBalanceForm } from "./AccountForms";

export const metadata: Metadata = { title: "Account" };

// Postgres throws on a malformed uuid, so reject those before querying.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [accounts, txRows] = await Promise.all([listAccounts(userId, { includeArchived: true }), listTransactions(userId)]);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();
  const balance = accountBalances([account], txRows).get(account.id) ?? 0;
  const archived = account.archivedAt !== null;

  return (
    <>
      <BackLink href="/more/accounts">Accounts</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">{account.name}</h1>
      <p className="mt-1 text-muted">
        {ACCOUNT_TYPE_LABEL[account.type]}
        {account.institution ? ` · ${account.institution}` : ""}
        {archived ? " · Archived" : ""}
      </p>
      <Amount
        value={balance}
        showPiasters
        className={`mt-4 block text-4xl font-semibold tracking-tight ${balance < 0 ? "text-negative" : ""}`}
      />

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Set balance</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            This records an adjustment for the difference, so your history stays as it is.
          </p>
          <SetBalanceForm id={account.id} isCreditCard={account.type === "credit_card"} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Details</h2>
        <div className={`p-5 ${card}`}>
          <EditAccountForm
            id={account.id}
            name={account.name}
            institution={account.institution}
            notes={account.notes}
          />
        </div>
      </section>

      <section className="mt-8">
        <ArchiveButton id={account.id} archived={archived} />
        <p className="mt-2 text-sm text-muted">Archived accounts stay in your net worth.</p>
      </section>
    </>
  );
}
