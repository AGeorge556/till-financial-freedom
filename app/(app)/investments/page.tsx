import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { AddHoldingForm } from "@/components/HoldingForms";
import { HoldingList } from "@/components/HoldingList";
import { HoldingPL } from "@/components/HoldingPL";
import { card } from "@/components/ui";
import { accountBalances, listAccounts, listTransactions } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { cairoToday } from "@/lib/finance-core/time";
import { type HoldingView, loadInvestments } from "./data";

export const metadata: Metadata = { title: "Investments" };

export default async function Page() {
  const userId = await requireUserId();
  const today = cairoToday();
  const [inv, accounts, txRows] = await Promise.all([
    loadInvestments(userId, today),
    listAccounts(userId, { includeArchived: true }),
    listTransactions(userId),
  ]);
  const balances = accountBalances(accounts, txRows);
  const active = inv.views.filter((v) => !v.row.archivedAt);
  const archived = inv.views.filter((v) => v.row.archivedAt);
  const homes = accounts.filter((a) => a.isInvestment && !a.archivedAt);

  const byAccount = new Map<string, HoldingView[]>();
  for (const v of active) byAccount.set(v.row.accountId, [...(byAccount.get(v.row.accountId) ?? []), v]);
  const groups = accounts
    .filter((a) => byAccount.has(a.id))
    .map((a) => {
      const views = byAccount.get(a.id)!;
      return { id: a.id, name: a.name, cash: balances.get(a.id) ?? 0, holdings: views.reduce((s, v) => s + v.value, 0), views };
    });

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Investments</h1>

      {active.length === 0 ? (
        <div className="mt-6">
          <EmptyState accent="investments" title="No holdings yet" items={["Stocks", "Funds"]}>
            {homes.length === 0 ? (
              <>
                First add an account that holds investments, like Thndr, in{" "}
                <Link href="/more/accounts" className="underline">
                  More &gt; Accounts
                </Link>
                . Then add what you own here.
              </>
            ) : (
              "Add a stock or fund you own, then record what you bought. You type in prices yourself. Nothing here connects to a broker."
            )}
          </EmptyState>
        </div>
      ) : (
        <>
          <section className={`mt-6 p-5 ${card}`}>
            <p className="text-sm text-muted">Holdings value</p>
            <Amount value={inv.total} className="mt-1 block text-4xl font-semibold tracking-tight text-investments" />
            {inv.stale && (
              <p className="mt-2 text-sm text-negative">
                ▲ Includes values last updated more than {inv.staleDays} days ago, or never updated.
              </p>
            )}
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">Profit or loss on what you still hold</dt>
                <dd className="mt-0.5 font-semibold">
                  <HoldingPL value={inv.unrealized} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Profit or loss on what you sold</dt>
                <dd className="mt-0.5 font-semibold">
                  <HoldingPL value={inv.realized} />
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted">
              Cost basis method: average cost. Prices are the ones you typed in, so they can be out of date.
            </p>
          </section>

          <HoldingList groups={groups} />
        </>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Add a holding</h2>
        <div className={`p-5 ${card}`}>
          {homes.length === 0 ? (
            <p className="text-muted">
              A holding lives in an account that holds investments.{" "}
              <Link href="/more/accounts" className="underline">
                Add or mark one in More &gt; Accounts
              </Link>
              .
            </p>
          ) : (
            <AddHoldingForm accounts={homes.map((a) => ({ id: a.id, name: a.name }))} />
          )}
        </div>
      </section>

      {archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Archived</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {archived.map((v) => (
              <li key={v.row.id}>
                <Link href={`/investments/${v.row.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 text-muted">
                  <span className="truncate">{v.row.name}</span>
                  <span className="shrink-0 text-sm">
                    Sold or written off: <HoldingPL value={v.state.realizedPL} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
