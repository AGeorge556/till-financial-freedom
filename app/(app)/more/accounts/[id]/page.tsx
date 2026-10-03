import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ACCOUNT_TYPE_LABEL } from "@/components/accountTypes";
import { Amount } from "@/components/Amount";
import { BackLink, card } from "@/components/ui";
import { accountValue, holdingsByAccount, loadInvestments } from "@/app/(app)/investments/data";
import { accountBalances, listAccounts, listTransactions } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { cairoToday } from "@/lib/finance-core/time";
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
  // A brokerage account is worth its cash plus what it holds, the same figure Home shows. Set balance changes the cash part only.
  const inv = account.isInvestment ? await loadInvestments(userId, cairoToday()) : null;
  const held = inv ? (holdingsByAccount(inv).get(account.id) ?? 0) : 0;
  const total = inv ? accountValue(balance, held) : balance;
  const here = inv
    ? [
        ...inv.views.filter((v) => v.row.accountId === account.id && !v.row.archivedAt).map((v) => ({ id: v.row.id, name: v.row.name, value: v.value })),
        ...inv.clouds.filter((c) => c.row.accountId === account.id && !c.row.archivedAt).map((c) => ({ id: c.row.id, name: c.row.name, value: c.est.value })),
      ]
    : [];

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
        value={total}
        showPiasters
        className={`mt-4 block text-4xl font-semibold tracking-tight ${total < 0 ? "text-negative" : ""}`}
      />
      {inv && (
        <>
          <p className="mt-1 text-muted">
            Cash <Amount value={balance} showPiasters /> + holdings <Amount value={held} showPiasters />
          </p>
          {here.length > 0 && (
            <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {here.map((h) => (
                <li key={h.id}>
                  <Link href={`/investments/${h.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                    <span className="truncate font-medium">{h.name}</span>
                    <Amount value={h.value} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Set balance</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            This records an adjustment for the difference, so your history stays as it is.
            {inv &&
              " It adjusts the cash part only. What you hold here is valued from its own prices and confirmed values: update those in Investments."}
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
