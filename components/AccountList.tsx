import Link from "next/link";
import { netWorth } from "@/lib/finance-core/ledger";
import { Amount } from "./Amount";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "./accountTypes";

export type AccountListItem = {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  /** Cash balance. */
  balance: number;
  /** Value of holdings kept in this account; shown and added to the balance when set. */
  holdings?: number;
};

/** Accounts with balances, each linking to its detail page. Credit cards show negative, receivables positive. A brokerage account shows cash plus holdings. */
export function AccountList({ accounts, muted }: { accounts: AccountListItem[]; muted?: boolean }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {accounts.map((a) => {
        const value = netWorth({ cash: a.balance, holdings: a.holdings ?? 0, liabilities: 0 });
        return (
          <li key={a.id}>
            <Link
              href={`/more/accounts/${a.id}`}
              className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2 ${muted ? "text-muted" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block truncate text-sm text-muted">
                  {ACCOUNT_TYPE_LABEL[a.type]}
                  {a.institution ? ` · ${a.institution}` : ""}
                </span>
                {a.holdings !== undefined && a.holdings > 0 && (
                  <span className="block text-sm text-muted">
                    Cash <Amount value={a.balance} /> + holdings <Amount value={a.holdings} />
                  </span>
                )}
              </span>
              <Amount value={value} className={`shrink-0 font-medium ${value < 0 ? "text-negative" : ""}`} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
