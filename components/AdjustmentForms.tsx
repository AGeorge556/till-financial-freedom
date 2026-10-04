"use client";

import { editAdjustment, voidAdjustment } from "@/app/actions/accounts";
import { Amount } from "./Amount";
import { EntryList, RemoveButton } from "./Correct";
import { Form } from "./Form";
import { dateText } from "./HoldingFormat";
import { Field, field, primaryBtn } from "./ui";

/** A "Set balance" entry: `amount` is the signed change it made, in piasters. */
export type AdjustmentRow = { key: string; id: string; date: string; amount: number; note: string | null; removed: boolean };

const what = (r: { date: string }) => `balance adjustment of ${dateText(r.date)}`;

const Change = ({ amount }: { amount: number }) => (
  <>
    {amount < 0 ? "−" : "+"}
    <Amount value={Math.abs(amount)} showPiasters />
  </>
);

/** Date and note of a balance adjustment. Its amount is corrected by setting the balance again, or the adjustment is removed. */
export function AdjustmentForm({ row, onDone }: { row: Omit<AdjustmentRow, "key" | "removed">; onDone?: () => void }) {
  return (
    <>
      <Form action={editAdjustment} onSuccess={onDone}>
        {({ pending }) => (
          <>
            <input type="hidden" name="id" value={row.id} />
            <p>
              <span className="text-sm text-muted">Change made to the balance</span>
              <span className="block text-xl font-semibold">
                <Change amount={row.amount} />
              </span>
            </p>
            <p className="mt-2 text-sm text-muted">
              The amount cannot be changed here. To correct the balance, set it again on the account page, or remove this adjustment.
            </p>
            <Field label="Date" className="mt-5">
              <input type="date" name="date" required defaultValue={row.date} className={field} />
            </Field>
            <Field label="Note (optional, no amounts)" className="mt-5">
              <input name="note" autoComplete="off" maxLength={500} defaultValue={row.note ?? ""} className={field} />
            </Field>
            <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
              {pending ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </Form>
      <RemoveButton action={voidAdjustment} id={row.id} noun="balance adjustment" what={what(row)} onDone={onDone} />
    </>
  );
}

/** An account's "Set balance" entries, newest first, each open to correction. */
export function AdjustmentList({ rows }: { rows: AdjustmentRow[] }) {
  return (
    <EntryList
      entries={rows}
      empty="No balance has been set on this account yet."
      name={what}
      title={(r) => `Edit ${what(r)}`}
      row={(r) => (
        <>
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium">Balance set</span>
            <span className="shrink-0 font-medium text-muted">
              <Change amount={r.amount} />
            </span>
          </span>
          <span className="block break-words text-sm text-muted">
            {dateText(r.date)}
            {r.note ? ` · ${r.note}` : ""}
          </span>
        </>
      )}
      sheet={(r, done) => <AdjustmentForm row={r} onDone={done} />}
    />
  );
}
