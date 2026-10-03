import Link from "next/link";
import type { CloudView } from "@/app/(app)/investments/data";
import { Amount } from "./Amount";
import { formatRate } from "./GoalFormat";
import { confirmedText } from "./HoldingFormat";
import { HoldingPL } from "./HoldingPL";

function Status({ c }: { c: CloudView }) {
  return (
    <span className="text-sm text-muted">
      {confirmedText(c.est.days)}
      {c.est.stale && (
        <span className="ml-2 rounded-full border border-negative px-2 py-0.5 text-xs font-medium text-negative">▲ Stale</span>
      )}
    </span>
  );
}

const th = "px-4 py-3 font-medium";

/** Savings Clouds: a card list on a phone, a table from 768px. Every value says whether it is estimated or confirmed. */
export function CloudList({ clouds }: { clouds: CloudView[] }) {
  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface md:hidden">
        {clouds.map((c) => (
          <li key={c.row.id}>
            <Link href={`/investments/${c.row.id}`} className="block min-h-14 px-4 py-3">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{c.row.name}</span>
                <span className="shrink-0 text-right">
                  <Amount value={c.est.value} className="font-medium" />
                  <span className="block text-xs text-muted">{c.est.label}</span>
                </span>
              </span>
              <span className="mt-0.5 flex items-baseline justify-between gap-3 text-sm text-muted">
                <span>
                  Yearly rate {c.rate ? formatRate(c.rate.apy) : "not set"}
                </span>
                <HoldingPL value={c.est.growth} className="shrink-0" />
              </span>
              <span className="mt-1 block">
                <Status c={c} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Savings Clouds</caption>
          <thead className="text-left text-muted">
            <tr>
              <th scope="col" className={th}>
                Cloud
              </th>
              <th scope="col" className={`${th} text-right`}>
                Value
              </th>
              <th scope="col" className={th}>
                Value is
              </th>
              <th scope="col" className={`${th} text-right`}>
                Yearly rate
              </th>
              <th scope="col" className={`${th} text-right`}>
                Growth so far
              </th>
              <th scope="col" className={th}>
                Confirmed
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {clouds.map((c) => (
              <tr key={c.row.id}>
                <td className="px-4 py-1">
                  <Link href={`/investments/${c.row.id}`} className="inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline">
                    {c.row.name}
                  </Link>
                </td>
                <td className="px-4 py-1 text-right font-medium">
                  <Amount value={c.est.value} />
                </td>
                <td className="px-4 py-1 text-muted">{c.est.label}</td>
                <td className="px-4 py-1 text-right">
                  {c.rate ? formatRate(c.rate.apy) : "not set"}
                </td>
                <td className="px-4 py-1 text-right">
                  <HoldingPL value={c.est.growth} />
                </td>
                <td className="px-4 py-1">
                  <Status c={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
