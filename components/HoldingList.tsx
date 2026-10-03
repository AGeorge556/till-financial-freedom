import Link from "next/link";
import { accountValue, type HoldingView } from "@/app/(app)/investments/data";
import { Amount } from "./Amount";
import { plain, updatedText } from "./HoldingFormat";
import { HoldingPL } from "./HoldingPL";
import { HoldingPrivate } from "./HoldingPrivate";

export type HoldingGroup = { id: string; name: string; cash: number; holdings: number; views: HoldingView[] };

function Status({ v }: { v: HoldingView }) {
  return (
    <span className="text-sm text-muted">
      {updatedText(v.source, v.days)}
      {v.stale && (
        <span className="ml-2 rounded-full border border-negative px-2 py-0.5 text-xs font-medium text-negative">▲ Stale</span>
      )}
    </span>
  );
}

const held = (v: HoldingView) => v.state.quantity !== "0";

function Cards({ views }: { views: HoldingView[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface md:hidden">
      {views.map((v) => (
        <li key={v.row.id}>
          <Link href={`/investments/${v.row.id}`} className="block min-h-14 px-4 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium">
                {v.row.name}
                {v.row.ticker && <span className="font-normal text-muted"> · {v.row.ticker}</span>}
              </span>
              <Amount value={v.value} className="shrink-0 font-medium" />
            </span>
            <span className="mt-0.5 flex items-baseline justify-between gap-3 text-sm text-muted">
              <span>
                {held(v) ? (
                  <>
                    <HoldingPrivate>{plain(v.state.quantity)}</HoldingPrivate> units, average cost{" "}
                    <Amount value={v.state.averageCost} showPiasters />
                  </>
                ) : (
                  "No units held"
                )}
              </span>
              <HoldingPL value={v.unrealized} className="shrink-0" />
            </span>
            <span className="mt-1 block">
              <Status v={v} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const th = "px-4 py-3 font-medium";

function Table({ name, views }: { name: string; views: HoldingView[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">Holdings in {name}</caption>
        <thead className="text-left text-muted">
          <tr>
            <th scope="col" className={th}>
              Holding
            </th>
            <th scope="col" className={`${th} text-right`}>
              Units
            </th>
            <th scope="col" className={`${th} text-right`}>
              Average cost
            </th>
            <th scope="col" className={`${th} text-right`}>
              Value
            </th>
            <th scope="col" className={`${th} text-right`}>
              Profit or loss
            </th>
            <th scope="col" className={th}>
              Price
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {views.map((v) => (
            <tr key={v.row.id}>
              <td className="px-4 py-1">
                <Link href={`/investments/${v.row.id}`} className="inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline">
                  {v.row.name}
                  {v.row.ticker && <span className="ml-1 font-normal text-muted">· {v.row.ticker}</span>}
                </Link>
              </td>
              <td className="px-4 py-1 text-right tabular-nums">
                {held(v) ? <HoldingPrivate>{plain(v.state.quantity)}</HoldingPrivate> : "–"}
              </td>
              <td className="px-4 py-1 text-right">{held(v) ? <Amount value={v.state.averageCost} showPiasters /> : "–"}</td>
              <td className="px-4 py-1 text-right font-medium">
                <Amount value={v.value} />
              </td>
              <td className="px-4 py-1 text-right">
                <HoldingPL value={v.unrealized} />
              </td>
              <td className="px-4 py-1">
                <Status v={v} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Holdings grouped by brokerage account: a card list on a phone, a table from 768px. */
export function HoldingList({ groups }: { groups: HoldingGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{g.name}</h2>
            <Amount value={accountValue(g.cash, g.holdings)} className="font-medium" />
          </div>
          <p className="mt-0.5 mb-2 text-sm text-muted">
            Cash <Amount value={g.cash} /> + holdings <Amount value={g.holdings} />
          </p>
          <Cards views={g.views} />
          <Table name={g.name} views={g.views} />
        </section>
      ))}
    </>
  );
}
