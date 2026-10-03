import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/Amount";
import { CloudList } from "@/components/CloudList";
import { EmptyState } from "@/components/EmptyState";
import { GoldPriceForm } from "@/components/GoldForms";
import { GoldPriceHistory, GoldPrices } from "@/components/GoldPrices";
import { AddHoldingForm } from "@/components/HoldingForms";
import { HoldingList } from "@/components/HoldingList";
import { HoldingPL } from "@/components/HoldingPL";
import { Panel } from "@/components/HoldingParts";
import { card } from "@/components/ui";
import { listAccounts } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { cairoToday } from "@/lib/finance-core/time";
import { loadInvestments } from "./data";

export const metadata: Metadata = { title: "Investments" };

function SectionHead({ title, total }: { title: string; total: number }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <Amount value={total} className="font-medium" />
    </div>
  );
}

export default async function Page() {
  const userId = await requireUserId();
  const today = cairoToday();
  const [inv, accounts] = await Promise.all([loadInvestments(userId, today), listAccounts(userId, { includeArchived: true })]);
  const { settings } = inv.portfolio;
  const active = inv.views.filter((v) => !v.row.archivedAt);
  const stocks = active.filter((v) => v.row.kind !== "gold");
  const gold = active.filter((v) => v.row.kind === "gold");
  const clouds = inv.clouds.filter((c) => !c.row.archivedAt);
  const archivedViews = inv.views.filter((v) => v.row.archivedAt);
  const archivedClouds = inv.clouds.filter((c) => c.row.archivedAt);
  const homes = accounts.filter((a) => a.isInvestment && !a.archivedAt);
  const nothing = active.length === 0 && clouds.length === 0;

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Investments</h1>

      {nothing ? (
        <div className="mt-6">
          <EmptyState accent="investments" title="No holdings yet" items={["Stocks", "Funds", "Gold", "Savings Clouds"]}>
            {homes.length === 0 ? (
              <>
                First add an account that holds investments, like Thndr, in{" "}
                <Link href="/more/accounts" className="underline">
                  More &gt; Accounts
                </Link>
                . Then add what you own here.
              </>
            ) : (
              "Add a stock, fund, gold or Savings Cloud you own, then record what you bought or deposited. You type in prices yourself. Nothing here connects to a broker."
            )}
          </EmptyState>
        </div>
      ) : (
        <>
          <section className={`mt-6 p-5 ${card}`}>
            <p className="text-sm text-muted">Investments value</p>
            <Amount value={inv.totals.all} className="mt-1 block text-4xl font-semibold tracking-tight text-investments" />
            {inv.stale && (
              <p className="mt-2 text-sm text-negative">
                ▲ Out of date: {inv.staleKinds.join(", ")}. Update them to keep this figure honest.
              </p>
            )}
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted">Stocks &amp; funds</dt>
                <dd className="mt-0.5 font-semibold">
                  <Amount value={inv.totals.stocks} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Gold</dt>
                <dd className="mt-0.5 font-semibold">
                  <Amount value={inv.totals.gold} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Savings Clouds (estimated)</dt>
                <dd className="mt-0.5 font-semibold">
                  <Amount value={inv.totals.clouds} />
                </dd>
              </div>
            </dl>
            <dl className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">Profit or loss on stocks, funds and gold you still hold</dt>
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
              <div>
                <dt className="text-sm text-muted">Savings Cloud growth so far (estimated)</dt>
                <dd className="mt-0.5 font-semibold">
                  <HoldingPL value={inv.cloudGrowth} />
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted">
              Cost basis method: average cost. Prices are the ones you typed in, so they can be out of date. Cloud growth is
              market change, not income.
            </p>
          </section>

          <section className="mt-8">
            <SectionHead title="Stocks & funds" total={inv.totals.stocks} />
            {stocks.length === 0 ? (
              <p className="text-muted">No stocks or funds yet.</p>
            ) : (
              <HoldingList name="Stocks and funds" views={stocks} />
            )}
          </section>

          <section className="mt-8">
            <SectionHead title="Gold" total={inv.totals.gold} />
            {gold.length === 0 ? (
              <p className="text-muted">No gold yet. Add a holding of type gold below.</p>
            ) : (
              <>
                <HoldingList name="Gold" views={gold} gold />
                <p className="mt-2 text-sm text-muted">
                  Gold is valued at the buy-back price, what a jeweler would pay you, not the price you paid.
                </p>
              </>
            )}
            <h3 className="mt-6 mb-2 font-semibold">Gold prices</h3>
            <GoldPrices prices={inv.portfolio.goldPrices} mode={settings.goldPriceMode} today={today} staleDays={settings.staleDaysGold} />
            <div className="mt-3">
              <Panel
                title="Update gold price"
                hint={
                  settings.goldPriceMode === "derive_24k"
                    ? "Type today's 24K buy-back price per gram. The other karats follow from it."
                    : "Type a buy-back price per gram for each karat."
                }
              >
                <GoldPriceForm mode={settings.goldPriceMode} today={today} />
              </Panel>
            </div>
            <GoldPriceHistory prices={inv.portfolio.goldPrices} />
          </section>

          <section className="mt-8">
            <SectionHead title="Savings Clouds" total={inv.totals.clouds} />
            {clouds.length === 0 ? (
              <p className="text-muted">No Savings Clouds yet.</p>
            ) : (
              <>
                <CloudList clouds={clouds} />
                <p className="mt-2 text-sm text-muted">
                  A cloud&apos;s value is an estimate from the yearly rate you entered, until you confirm the actual value.
                </p>
              </>
            )}
          </section>
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
            <AddHoldingForm accounts={homes.map((a) => ({ id: a.id, name: a.name }))} today={today} />
          )}
        </div>
      </section>

      {archivedViews.length + archivedClouds.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Archived</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {archivedViews.map((v) => (
              <li key={v.row.id}>
                <Link href={`/investments/${v.row.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 text-muted">
                  <span className="truncate">{v.row.name}</span>
                  <span className="shrink-0 text-sm">
                    Sold or written off: <HoldingPL value={v.state.realizedPL} />
                  </span>
                </Link>
              </li>
            ))}
            {archivedClouds.map((c) => (
              <li key={c.row.id}>
                <Link href={`/investments/${c.row.id}`} className="flex min-h-14 items-center px-4 py-2 text-muted">
                  <span className="truncate">{c.row.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
