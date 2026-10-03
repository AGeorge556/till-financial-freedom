import type { GoldPriceEntry } from "@/db/queries";
import { goldPriceAsOf, type GoldPriceMode, KARATS } from "@/lib/finance-core/gold";
import { staleness } from "@/lib/finance-core/portfolio";
import { dateText, plain } from "./HoldingFormat";
import { HoldingPrivate } from "./HoldingPrivate";

/** The buy-back price in force today for each karat (derived in derive_24k mode), how old it is, and the latest entries. */
export function GoldPrices({
  prices,
  mode,
  today,
  staleDays,
}: {
  prices: GoldPriceEntry[];
  mode: GoldPriceMode;
  today: string;
  staleDays: number;
}) {
  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {KARATS.map((k) => {
          const p = goldPriceAsOf(prices, k, today, mode);
          const age = p ? staleness(p.date, today, staleDays) : null;
          return (
            <li key={k} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-medium">{k}K</span>
                <span className="block text-sm text-muted">
                  {p === null
                    ? "No price entered yet"
                    : `${mode === "derive_24k" && k !== 24 ? "Worked out from the 24K price, " : ""}${dateText(p.date)}${
                        age?.days ? `, ${age.days} ${age.days === 1 ? "day" : "days"} ago` : ", today"
                      }`}
                  {age?.stale && (
                    <span className="ml-2 rounded-full border border-negative px-2 py-0.5 text-xs font-medium text-negative">▲ Stale</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 font-medium">
                {p === null ? "–" : <HoldingPrivate>{plain(p.price)} EGP per gram</HoldingPrivate>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm text-muted">
        Buy-back price: what a jeweler would pay you for the gold, not the shop price. Prices are the ones you typed in.
        Older prices stay in the history and are never edited.
      </p>
    </div>
  );
}

/** The latest entries as typed, newest first. */
export function GoldPriceHistory({ prices }: { prices: GoldPriceEntry[] }) {
  if (prices.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface text-sm">
      {prices.slice(0, 8).map((p) => (
        <li key={p.id} className="flex items-baseline justify-between gap-3 px-4 py-2">
          <span className="text-muted">
            {dateText(p.date)} · {p.karat}K
          </span>
          <HoldingPrivate>{plain(p.price)} EGP per gram</HoldingPrivate>
        </li>
      ))}
    </ul>
  );
}
