import type { Metadata } from "next";
import { AccountList } from "@/components/AccountList";
import { BackLink, card } from "@/components/ui";
import { accountBalances, listAccounts, listTransactions } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { AddAccountForm } from "./AddAccountForm";

export const metadata: Metadata = { title: "Accounts" };

export default async function Page() {
  const userId = await requireUserId();
  const [accounts, txRows] = await Promise.all([
    listAccounts(userId, { includeArchived: true }),
    listTransactions(userId),
  ]);
  const balances = accountBalances(accounts, txRows);
  const withBalance = (archived: boolean) =>
    accounts
      .filter((a) => (a.archivedAt !== null) === archived)
      .map((a) => ({ ...a, balance: balances.get(a.id) ?? 0 }));
  const active = withBalance(false);
  const archived = withBalance(true);

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Accounts</h1>

      <div className="mt-6">
        {active.length > 0 ? (
          <AccountList accounts={active} />
        ) : (
          <p className="text-muted">No accounts yet. Add your first one below.</p>
        )}
      </div>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Add an account</h2>
        <div className={`p-5 ${card}`}>
          <AddAccountForm />
        </div>
      </section>

      {archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Archived</h2>
          <AccountList accounts={archived} muted />
        </section>
      )}
    </>
  );
}
