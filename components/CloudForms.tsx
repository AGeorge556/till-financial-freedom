"use client";

import {
  addRateChange,
  confirmCloudValue,
  depositToCloud,
  editCloudConfirmation,
  editCloudFlow,
  editRateChange,
  removeCloudConfirmation,
  removeRateChange,
  voidCloudFlow,
  withdrawFromCloud,
} from "@/app/actions/clouds";
import { RemoveButton, usableAccounts } from "./Correct";
import { Form } from "./Form";
import { egpText, ratePercentText } from "./GoalFormat";
import { decimalInput, Saved } from "./HoldingForms";
import type { AccountOption } from "./TransactionForm";
import { Field, field, primaryBtn } from "./ui";

export type FlowEditing = { id: string; amount: number; date: string; note: string | null; accountId: string | null; what: string };

/** Deposit or withdrawal. Depositing is investing, not spending; withdrawing is refused above the estimated value. */
export function CloudFlowForm({
  side,
  holdingId,
  accountId,
  accounts: allAccounts,
  today,
  autoFocus,
  editing,
  onDone,
}: {
  side: "deposit" | "withdraw";
  holdingId: string;
  accountId: string;
  accounts: AccountOption[];
  today: string;
  autoFocus?: boolean;
  editing?: FlowEditing;
  onDone?: () => void;
}) {
  const deposit = side === "deposit";
  const accounts = usableAccounts(allAccounts, editing?.accountId);
  const wanted = editing?.accountId ?? accountId;
  const selected = accounts.some((a) => a.id === wanted) ? wanted : (accounts[0]?.id ?? "");
  return (
    <>
      <Form action={editing ? editCloudFlow : deposit ? depositToCloud : withdrawFromCloud} reset={!editing} onSuccess={onDone}>
        {({ pending, saved }) => (
          <>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="holdingId" value={holdingId} />
            <Field label="Amount (EGP)">
              <input
                name="amount"
                {...decimalInput}
                required
                autoFocus={autoFocus}
                data-autofocus={autoFocus ? "" : undefined}
                placeholder="0"
                defaultValue={editing ? egpText(editing.amount) : undefined}
                className={field}
              />
            </Field>
            <p className="mt-2 text-sm text-muted">
              {deposit
                ? "Moving money into a cloud is investing, not spending."
                : "You cannot take out more than the cloud's estimated value on that date."}
            </p>
            <Field label={deposit ? "Paid from" : "Cash goes to"} className="mt-4">
              <select name="accountId" defaultValue={selected} required className={field}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date" className="mt-4">
              <input type="date" name="date" required max={today} defaultValue={editing?.date ?? today} className={field} />
            </Field>
            <Field label="Note (optional, no amounts)" className="mt-4">
              <input name="note" autoComplete="off" maxLength={500} defaultValue={editing?.note ?? ""} className={field} />
            </Field>
            <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
              {pending ? "Saving…" : editing ? "Save" : deposit ? "Record deposit" : "Record withdrawal"}
            </button>
            {!editing && <Saved show={saved}>{deposit ? "Deposit recorded." : "Withdrawal recorded."}</Saved>}
          </>
        )}
      </Form>
      {editing && <RemoveButton action={voidCloudFlow} id={editing.id} noun={deposit ? "deposit" : "withdrawal"} what={editing.what} onDone={onDone} />}
    </>
  );
}

export type RateEditing = { id: string; apy: number; date: string; what: string };

/** A new APY from a date, or with `editing` a correction of a saved one. */
export function CloudRateForm({ holdingId, today, editing, onDone }: { holdingId: string; today: string; editing?: RateEditing; onDone?: () => void }) {
  return (
    <>
      <Form action={editing ? editRateChange : addRateChange} reset={!editing} onSuccess={onDone}>
        {({ pending, saved }) => (
          <>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="holdingId" value={holdingId} />
            <Field label="Yearly rate, APY (%)">
              <input
                name="apy"
                {...decimalInput}
                required
                placeholder="20"
                defaultValue={editing ? ratePercentText(editing.apy) : undefined}
                className={field}
              />
            </Field>
            <p className="mt-2 text-sm text-muted">
              APY is the effective rate for a whole year, with growth added on top of growth inside the product. It is not a
              monthly rate. Type the one the provider shows you.
            </p>
            <Field label="Takes effect on" className="mt-4">
              <input type="date" name="effectiveDate" required defaultValue={editing?.date ?? today} className={field} />
            </Field>
            <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
              {pending ? "Saving…" : editing ? "Save" : "Save rate"}
            </button>
            {!editing && <Saved show={saved}>Rate saved.</Saved>}
          </>
        )}
      </Form>
      {editing && <RemoveButton action={removeRateChange} id={editing.id} noun="rate change" what={editing.what} onDone={onDone} />}
    </>
  );
}

export type ConfirmEditing = { id: string; value: number; date: string; what: string };

/** The actual value read off the product, or with `editing` a correction of a saved one. It is the starting point for the estimate. */
export function CloudConfirmForm({ holdingId, today, editing, onDone }: { holdingId: string; today: string; editing?: ConfirmEditing; onDone?: () => void }) {
  return (
    <>
      <Form action={editing ? editCloudConfirmation : confirmCloudValue} reset={!editing} onSuccess={onDone}>
        {({ pending, saved }) => (
          <>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="holdingId" value={holdingId} />
            <Field label="Actual value now (EGP)">
              <input
                name="value"
                {...decimalInput}
                required
                placeholder="0"
                defaultValue={editing ? egpText(editing.value) : undefined}
                className={field}
              />
            </Field>
            <p className="mt-2 text-sm text-muted">
              Type what the provider shows. It becomes the new starting point: the estimate grows from this value from now on.
            </p>
            <Field label="Value as of" className="mt-4">
              <input type="date" name="date" required max={today} defaultValue={editing?.date ?? today} className={field} />
            </Field>
            <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
              {pending ? "Saving…" : editing ? "Save" : "Confirm value"}
            </button>
            {!editing && <Saved show={saved}>Value confirmed.</Saved>}
          </>
        )}
      </Form>
      {editing && <RemoveButton action={removeCloudConfirmation} id={editing.id} noun="confirmed value" what={editing.what} onDone={onDone} />}
    </>
  );
}
