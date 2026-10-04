import type { LiabilityEntry } from "@/app/(app)/more/liabilities/data";
import { Amount } from "./Amount";
import { dateText } from "./HoldingFormat";
import { LiabilityVoidButton } from "./LiabilityForms";

/** Payments and manual updates, newest first. A payment can be voided (principal and interest together); updates are append-only. */
export function LiabilityHistory({ entries }: { entries: LiabilityEntry[] }) {
  if (entries.length === 0) return <p className="text-muted">Nothing recorded yet.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {entries.map((e) => (
        <li key={e.key} className={`px-4 py-3 ${e.kind === "payment" && e.voided ? "text-muted" : ""}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 font-medium">
              {e.kind === "payment" ? "Payment" : e.delta > 0 ? "Owe more" : "Owe less"}
              {e.kind === "payment" && e.voided && (
                <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal">voided</span>
              )}
            </span>
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
          </div>
          <p className="text-sm text-muted">
            {dateText(e.date)}
            {e.note ? ` · ${e.note}` : ""}
          </p>
          {e.kind === "payment" ? (
            <p className="text-sm text-muted">
              Principal, reduces the loan.
              {e.interest > 0 && (
                <>
                  {" "}
                  Interest <Amount value={e.interest} showPiasters />, counted as spending.
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted">No cash moved.</p>
          )}
          {e.kind === "payment" && !e.voided && <LiabilityVoidButton id={e.txId} what={`payment of ${dateText(e.date)}`} />}
        </li>
      ))}
    </ul>
  );
}
