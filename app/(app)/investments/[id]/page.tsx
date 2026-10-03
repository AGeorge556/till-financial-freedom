import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Amount } from "@/components/Amount";
import { dateText, KIND_LABEL, plain, updatedText } from "@/components/HoldingFormat";
import {
  CorporateActionForm,
  DividendForm,
  HoldingArchiveButton,
  HoldingEditForm,
  PriceForm,
  TradeForm,
} from "@/components/HoldingForms";
import { HoldingHistory } from "@/components/HoldingHistory";
import { Panel, Row, StaleBadge } from "@/components/HoldingParts";
import { HoldingPL } from "@/components/HoldingPL";
import { HoldingPrivate } from "@/components/HoldingPrivate";
import { BackLink, card } from "@/components/ui";
import { listAccounts } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { cairoToday } from "@/lib/finance-core/time";
import { CloudDetail } from "./CloudDetail";
import { GoldDetail } from "./GoldDetail";
import { holdingHistory, loadInvestments } from "../data";

export const metadata: Metadata = { title: "Holding" };

// Postgres throws on a malformed uuid, so reject those before querying.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const today = cairoToday();
  const [inv, accounts] = await Promise.all([loadInvestments(userId, today), listAccounts(userId, { includeArchived: true })]);
  const cloud = inv.clouds.find((c) => c.row.id === id);
  const view = inv.views.find((v) => v.row.id === id);
  const row = cloud?.row ?? view?.row;
  if (!row) notFound();
  const cashAccounts = accounts.filter((a) => !a.archivedAt).map((a) => ({ id: a.id, name: a.name, archived: false }));
  const accountName = accounts.find((a) => a.id === row.accountId)?.name ?? "an account";
  const history = holdingHistory(inv.portfolio, id, row.priceUpdates);
  if (cloud) return <CloudDetail view={cloud} accountName={accountName} cashAccounts={cashAccounts} today={today} history={history} />;
  if (!view) notFound();
  if (row.kind === "gold") {
    return (
      <GoldDetail
        view={view}
        accountName={accountName}
        cashAccounts={cashAccounts}
        mode={inv.portfolio.settings.goldPriceMode}
        today={today}
        history={history}
      />
    );
  }
  const { state } = view;
  const archived = row.archivedAt !== null;
  const held = state.quantity !== "0";
  const option = { id: row.id, name: row.name, ticker: row.ticker, accountId: row.accountId, kind: row.kind };

  return (
    <>
      <BackLink href="/investments">Investments</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">{row.name}</h1>
      <p className="mt-1 text-muted">
        {KIND_LABEL[row.kind]}
        {row.ticker ? ` · ${row.ticker}` : ""} · Held in {accountName}
        {archived ? " · Archived" : ""}
      </p>
      {row.notes && <p className="mt-2">{row.notes}</p>}

      <section className={`mt-6 p-5 ${card}`}>
        <p className="text-sm text-muted">Current value</p>
        <Amount value={view.value} showPiasters className="mt-1 block text-4xl font-semibold tracking-tight text-investments" />
        <p className="mt-1 text-sm text-muted">
          {updatedText(view.source, view.days)}
          {view.stale && <StaleBadge />}
        </p>
        <dl className="mt-3 divide-y divide-border border-t border-border">
          <Row label="Units held">
            <HoldingPrivate>{plain(state.quantity)}</HoldingPrivate>
          </Row>
          <Row label="Average cost per unit" hint="Cost basis method: average cost">
            <Amount value={state.averageCost} showPiasters />
          </Row>
          <Row label="Cost of what you still hold">
            <Amount value={state.costBasis} showPiasters />
          </Row>
          <Row label="Total invested" hint="Everything you paid for purchases, fees included">
            <Amount value={state.invested} showPiasters />
          </Row>
          <Row
            label="Current price per unit"
            hint={
              view.source === "price"
                ? `Price from ${dateText(view.priceDate!)}`
                : view.source === "last-transaction"
                  ? "Valued at last transaction price"
                  : "No price yet"
            }
          >
            {view.price === null ? "–" : <HoldingPrivate>{plain(view.price)} EGP</HoldingPrivate>}
          </Row>
          <Row label="Profit or loss on what you still hold">
            <HoldingPL value={view.unrealized} showPiasters />
          </Row>
          <Row label="Profit or loss on what you sold" hint="Includes any write-off">
            <HoldingPL value={state.realizedPL} showPiasters />
          </Row>
          <Row label="Dividends received" hint="After tax">
            <Amount value={state.dividendsNet} showPiasters />
          </Row>
        </dl>
        <p className="mt-3 text-sm text-muted">Prices are the ones you typed in. Profit or loss is not final until you sell.</p>
      </section>

      {archived ? (
        <p className="mt-6 text-muted">This holding is archived. Restore it to record anything new.</p>
      ) : (
        <section className="mt-6 space-y-3">
          <h2 className="sr-only">Record something</h2>
          <Panel title="Update price" hint="Type the price per unit you see now. Older prices stay in the history.">
            <PriceForm holdings={[option]} today={today} />
          </Panel>
          <Panel title="Buy" hint="Moving money to your brokerage is a transfer. Record what you bought here.">
            <TradeForm side="buy" holdings={[option]} accounts={cashAccounts} today={today} />
          </Panel>
          <Panel title="Sell" hint="The fee and any tax withheld come off what you receive.">
            <TradeForm side="sell" holdings={[option]} accounts={cashAccounts} today={today} />
          </Panel>
          <Panel title="Dividend" hint="Dividends count as investment income, not as a sale.">
            <DividendForm holdingId={row.id} accountId={row.accountId} accounts={cashAccounts} today={today} />
          </Panel>
          <Panel title="Bonus units, split or write-off" hint="These move no cash.">
            <CorporateActionForm holdingId={row.id} today={today} />
          </Panel>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">History</h2>
        <HoldingHistory entries={history} />
        <p className="mt-2 text-sm text-muted">Voided entries are left out here. Prices and corporate actions are never edited.</p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Details</h2>
        <div className={`p-5 ${card}`}>
          <HoldingEditForm id={row.id} name={row.name} ticker={row.ticker} notes={row.notes} />
        </div>
      </section>

      <section className="mt-8">
        <HoldingArchiveButton id={row.id} archived={archived} canArchive={!held} />
        <p className="mt-2 text-sm text-muted">
          {held ? "You can archive a holding once you hold 0 units." : "An archived holding leaves your lists. Its history stays."}
        </p>
      </section>
    </>
  );
}
