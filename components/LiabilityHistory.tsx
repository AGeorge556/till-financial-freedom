"use client";

import type { LiabilityEntry } from "@/app/(app)/more/liabilities/data";
import { Amount } from "./Amount";
import { EntryList } from "./Correct";
import { dateText } from "./HoldingFormat";
import { LiabilityUpdateForm, PaymentForm } from "./LiabilityForms";
import type { AccountOption, CategoryOption } from "./TransactionForm";

const what = (e: LiabilityEntry) => `${e.kind === "payment" ? "payment" : "update"} of ${dateText(e.date)}`;

/**
 * Payments and manual updates, newest first. Each opens its form, filled in, to be corrected or removed. A payment is
 * corrected as one (principal and interest together). Removed entries wait behind "Show removed".
 */
export function LiabilityHistory({
  entries,
  liabilityId,
  accounts,
  categories,
  today,
}: {
  entries: LiabilityEntry[];
  liabilityId: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  return (
    <EntryList
      entries={entries}
      name={what}
      title={(e) => `Edit ${what(e)}`}
      row={(e) => (
        <>
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words font-medium">{e.kind === "payment" ? "Payment" : e.delta > 0 ? "Owe more" : "Owe less"}</span>
            <span className="shrink-0 font-medium">
              {e.kind === "payment" ? (
                <>
                  −<Amount value={e.principal} showPiasters />
                </>
              ) : (
                <>
                  {e.delta > 0 ? "+" : "−"}
                  <Amount value={Math.abs(e.delta)} showPiasters />
                </>
              )}
            </span>
          </span>
          <span className="block break-words text-sm text-muted">
            {dateText(e.date)}
            {e.note ? ` · ${e.note}` : ""}
          </span>
          {e.kind === "payment" ? (
            <span className="block break-words text-sm text-muted">
              Principal, reduces the loan.
              {e.interest > 0 && (
                <>
                  {" "}
                  Interest <Amount value={e.interest} showPiasters />, counted as spending.
                </>
              )}
            </span>
          ) : (
            <span className="block break-words text-sm text-muted">No cash moved.</span>
          )}
        </>
      )}
      sheet={(e, done) =>
        e.kind === "payment" ? (
          <PaymentForm
            liabilityId={liabilityId}
            accounts={accounts}
            categories={categories}
            today={today}
            onDone={done}
            editing={{
              id: e.txId,
              principal: e.principal,
              interest: e.interest,
              categoryId: e.categoryId,
              accountId: e.accountId,
              date: e.date,
              note: e.note,
              what: what(e),
            }}
          />
        ) : (
          <LiabilityUpdateForm
            liabilityId={liabilityId}
            today={today}
            onDone={done}
            editing={{ id: e.id, delta: e.delta, date: e.date, note: e.note, what: what(e) }}
          />
        )
      }
    />
  );
}
