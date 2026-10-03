import Link from "next/link";
import type { LiabilityView } from "@/db/queries";
import { Amount } from "./Amount";
import { dateText } from "./HoldingFormat";
import { ratePercentText } from "./GoalFormat";

const KIND_LABEL = { loan: "Loan", owed: "Money owed", other: "Other" } as const;

const rate = (r: number | null) => (r === null ? "No rate noted" : `${ratePercentText(r)}% a year`);

const th = "px-4 py-3 font-medium";

/** Loans and money owed: a card list on a phone, a table from 768px. */
export function LiabilityList({ liabilities, muted }: { liabilities: LiabilityView[]; muted?: boolean }) {
  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface md:hidden">
        {liabilities.map((l) => (
          <li key={l.id}>
            <Link
              href={`/more/liabilities/${l.id}`}
              className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2 ${muted ? "text-muted" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block truncate text-sm text-muted">
                  {KIND_LABEL[l.kind]} · {rate(l.interestRate)}
                </span>
              </span>
              <Amount value={l.outstanding} className="shrink-0 font-medium" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Loans and money owed</caption>
          <thead className="text-left text-muted">
            <tr>
              <th scope="col" className={th}>
                Name
              </th>
              <th scope="col" className={th}>
                Type
              </th>
              <th scope="col" className={th}>
                Interest rate
              </th>
              <th scope="col" className={th}>
                Since
              </th>
              <th scope="col" className={`${th} text-right`}>
                Outstanding
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-border ${muted ? "text-muted" : ""}`}>
            {liabilities.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-1">
                  <Link href={`/more/liabilities/${l.id}`} className="inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline">
                    {l.name}
                  </Link>
                </td>
                <td className="px-4 py-1">{KIND_LABEL[l.kind]}</td>
                <td className="px-4 py-1">{rate(l.interestRate)}</td>
                <td className="px-4 py-1">{dateText(l.startDate)}</td>
                <td className="px-4 py-1 text-right font-medium">
                  <Amount value={l.outstanding} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
