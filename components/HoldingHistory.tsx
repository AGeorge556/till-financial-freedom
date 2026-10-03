import type { ReactNode } from "react";
import type { HistoryEntry } from "@/app/(app)/investments/data";
import { Amount } from "./Amount";
import { dateText, plain } from "./HoldingFormat";
import { HoldingVoidButton } from "./HoldingForms";
import { HoldingPrivate } from "./HoldingPrivate";

function describe(e: HistoryEntry): { title: ReactNode; detail?: ReactNode; amount?: ReactNode } {
  switch (e.kind) {
    case "buy":
      return {
        title: (
          <>
            Bought <HoldingPrivate>{plain(e.quantity)}</HoldingPrivate> at <HoldingPrivate>{plain(e.price)}</HoldingPrivate>
          </>
        ),
        detail: e.fee > 0 && (
          <>
            Fee <Amount value={e.fee} showPiasters />, added to your cost
          </>
        ),
        amount: (
          <>
            −<Amount value={e.amount} showPiasters />
          </>
        ),
      };
    case "sell":
      return {
        title: (
          <>
            Sold <HoldingPrivate>{plain(e.quantity)}</HoldingPrivate> at <HoldingPrivate>{plain(e.price)}</HoldingPrivate>
          </>
        ),
        detail: (e.fee > 0 || e.tax > 0) && (
          <>
            Fee <Amount value={e.fee} showPiasters />, tax <Amount value={e.tax} showPiasters />
          </>
        ),
        amount: (
          <span className="text-positive">
            +<Amount value={e.amount} showPiasters />
          </span>
        ),
      };
    case "dividend":
      return {
        title: "Dividend",
        detail: (
          <>
            Before tax <Amount value={e.gross} showPiasters />, tax <Amount value={e.tax} showPiasters />
          </>
        ),
        amount: (
          <span className="text-positive">
            +<Amount value={e.amount} showPiasters />
          </span>
        ),
      };
    case "bonus":
      return { title: <>Bonus units: +<HoldingPrivate>{plain(e.quantity)}</HoldingPrivate></>, detail: "No cash moved. Total cost unchanged." };
    case "split":
      return { title: <>Split, units × <HoldingPrivate>{plain(e.ratio)}</HoldingPrivate></>, detail: "No cash moved. Total cost unchanged." };
    case "writeOff":
      return { title: "Written off", detail: "Units and cost went to zero. The remaining cost is a realized loss." };
    case "price":
      return { title: <>Price set to <HoldingPrivate>{plain(e.price)}</HoldingPrivate> per unit</> };
  }
}

/** Dated history of one holding, newest first. Buys, sales and dividends can be voided; the rest is append-only. */
export function HoldingHistory({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <p className="text-muted">Nothing recorded yet.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {entries.map((e) => {
        const { title, detail, amount } = describe(e);
        const voidable = e.kind === "buy" || e.kind === "sell" || e.kind === "dividend";
        return (
          <li key={e.key} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-medium">{title}</span>
              {amount && <span className="shrink-0 font-medium">{amount}</span>}
            </div>
            <p className="text-sm text-muted">
              {dateText(e.date)}
              {e.note ? ` · ${e.note}` : ""}
            </p>
            {detail && <p className="text-sm text-muted">{detail}</p>}
            {voidable && <HoldingVoidButton id={e.txId} />}
          </li>
        );
      })}
    </ul>
  );
}
