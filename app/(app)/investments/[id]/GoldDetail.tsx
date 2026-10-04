import { Amount } from "@/components/Amount";
import { dateText, goldName, plain, updatedText } from "@/components/HoldingFormat";
import { CorporateActionForm, HoldingArchiveButton, HoldingEditForm, TradeForm } from "@/components/HoldingForms";
import { GoldPriceForm } from "@/components/GoldForms";
import { HoldingHistory } from "@/components/HoldingHistory";
import { Panel, Row, StaleBadge } from "@/components/HoldingParts";
import { HoldingPL } from "@/components/HoldingPL";
import { HoldingPrivate } from "@/components/HoldingPrivate";
import type { AccountOption } from "@/components/TransactionForm";
import { BackLink, card } from "@/components/ui";
import type { GoldPriceMode } from "@/lib/finance-core/gold";
import type { HistoryEntry, HoldingView } from "../data";

/** Physical gold: valued at the buy-back price per gram. Workmanship is cost, so a new piece starts at a loss. */
export function GoldDetail({
  view,
  accountName,
  cashAccounts,
  historyAccounts,
  mode,
  today,
  history,
}: {
  view: HoldingView;
  accountName: string;
  cashAccounts: AccountOption[];
  /** Every account, archived ones flagged, so a correction can keep the account an entry already used. */
  historyAccounts: AccountOption[];
  mode: GoldPriceMode;
  today: string;
  history: HistoryEntry[];
}) {
  const { row, state } = view;
  const archived = row.archivedAt !== null;
  const held = state.quantity !== "0";
  const option = { id: row.id, name: row.name, ticker: null, accountId: row.accountId, kind: row.kind };
  const derived = mode === "derive_24k" && row.karat !== 24;

  return (
    <>
      <BackLink href="/investments">Investments</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">{row.name}</h1>
      <p className="mt-1 text-muted">
        Gold · {goldName(row.karat, row.form)} · Held in {accountName}
        {archived ? " · Archived" : ""}
      </p>
      {row.notes && <p className="mt-2">{row.notes}</p>}

      <section className={`mt-6 p-5 ${card}`}>
        <p className="text-sm text-muted">Current value at the buy-back price</p>
        <Amount value={view.value} showPiasters className="mt-1 block text-4xl font-semibold tracking-tight text-investments" />
        <p className="mt-1 text-sm text-muted">
          {updatedText(view.source, view.days, true)}
          {view.stale && <StaleBadge />}
        </p>
        <dl className="mt-3 divide-y divide-border border-t border-border">
          <Row label="Grams held">
            <HoldingPrivate>{plain(state.quantity)} g</HoldingPrivate>
          </Row>
          <Row
            label="Price per gram used"
            hint={
              view.source === "price"
                ? `Buy-back price from ${dateText(view.priceDate!)}${derived ? ", worked out from the 24K price" : ""}`
                : view.source === "last-transaction"
                  ? "No gold price entered, so this is your last transaction price"
                  : "No price yet"
            }
          >
            {view.price === null ? "–" : <HoldingPrivate>{plain(view.price)} EGP</HoldingPrivate>}
          </Row>
          <Row label="Average cost per gram" hint="Workmanship included">
            <Amount value={state.averageCost} showPiasters />
          </Row>
          <Row label="Cost of what you still hold" hint="What you paid for it, workmanship included">
            <Amount value={state.costBasis} showPiasters />
          </Row>
          <Row label="Total invested" hint="Everything you paid for purchases, workmanship included">
            <Amount value={state.invested} showPiasters />
          </Row>
          <Row label="Profit or loss on what you still hold" hint="Workmanship is a cost, so a new piece starts below what you paid">
            <HoldingPL value={view.unrealized} showPiasters />
          </Row>
          <Row label="Profit or loss on what you sold" hint="Includes any write-off">
            <HoldingPL value={state.realizedPL} showPiasters />
          </Row>
        </dl>
        <p className="mt-3 text-sm text-muted">
          Prices are the ones you typed in. Profit or loss is not final until you sell.
        </p>
      </section>

      {archived ? (
        <p className="mt-6 text-muted">This holding is archived. Restore it to record anything new.</p>
      ) : (
        <section className="mt-6 space-y-3">
          <h2 className="sr-only">Record something</h2>
          <Panel
            title="Buy"
            hint="Weight, the metal price per gram that day, and the workmanship the jeweler charged on top. Moving money to a gold account is a transfer; record what you bought here."
          >
            <TradeForm side="buy" holdings={[option]} accounts={cashAccounts} today={today} />
          </Panel>
          <Panel title="Sell" hint="Type the weight and the price per gram you were paid. A fee comes off what you receive.">
            <TradeForm side="sell" holdings={[option]} accounts={cashAccounts} today={today} />
          </Panel>
          <Panel
            title="Update gold price"
            hint={
              mode === "derive_24k"
                ? "Gold prices are shared by all your gold. Type the 24K buy-back price per gram; the other karats follow."
                : "Gold prices are shared by all your gold. Type a buy-back price per gram for each karat."
            }
          >
            <GoldPriceForm mode={mode} today={today} />
          </Panel>
          <Panel title="Lost or written off" hint="Moves no cash.">
            <CorporateActionForm holdingId={row.id} today={today} writeOffOnly />
          </Panel>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">History</h2>
        <HoldingHistory entries={history} holding={option} accounts={historyAccounts} today={today} gold />
        <p className="mt-2 text-sm text-muted">
          Tap an entry to correct or remove it. A removed entry stops counting but stays in your history: use Show removed. Gold prices are
          shared: correct them in the list on the Investments page.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Details</h2>
        <div className={`p-5 ${card}`}>
          <HoldingEditForm id={row.id} name={row.name} notes={row.notes} gold={{ karat: row.karat, form: row.form }} />
        </div>
      </section>

      <section className="mt-8">
        <HoldingArchiveButton id={row.id} archived={archived} canArchive={!held} />
        <p className="mt-2 text-sm text-muted">
          {held ? "You can archive a holding once you hold 0 grams." : "An archived holding leaves your lists. Its history stays."}
        </p>
      </section>
    </>
  );
}
