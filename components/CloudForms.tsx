"use client";

import { addRateChange, confirmCloudValue, depositToCloud, updateCloud, withdrawFromCloud } from "@/app/actions/clouds";
import { Form } from "./Form";
import { egpText } from "./GoalFormat";
import { decimalInput, Saved } from "./HoldingForms";
import type { AccountOption } from "./TransactionForm";
import { Field, field, primaryBtn } from "./ui";

/** Deposit or withdrawal. Depositing is investing, not spending; withdrawing is refused above the estimated value. */
export function CloudFlowForm({
  side,
  holdingId,
  accountId,
  accounts,
  today,
  autoFocus,
  onDone,
}: {
  side: "deposit" | "withdraw";
  holdingId: string;
  accountId: string;
  accounts: AccountOption[];
  today: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const deposit = side === "deposit";
  const selected = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? "");
  return (
    <Form action={deposit ? depositToCloud : withdrawFromCloud} reset onSuccess={onDone}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="holdingId" value={holdingId} />
          <Field label="Amount (EGP)">
            <input
              name="amount"
              {...decimalInput}
              required
              autoFocus={autoFocus}
              data-autofocus={autoFocus ? "" : undefined}
              placeholder="0"
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
            <input type="date" name="date" required max={today} defaultValue={today} className={field} />
          </Field>
          <Field label="Note (optional, no amounts)" className="mt-4">
            <input name="note" autoComplete="off" maxLength={500} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : deposit ? "Record deposit" : "Record withdrawal"}
          </button>
          <Saved show={saved}>{deposit ? "Deposit recorded." : "Withdrawal recorded."}</Saved>
        </>
      )}
    </Form>
  );
}

/** A new APY from a date. Rates are only added; the old ones stay in the history. */
export function CloudRateForm({ holdingId, today }: { holdingId: string; today: string }) {
  return (
    <Form action={addRateChange} reset>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="holdingId" value={holdingId} />
          <Field label="Yearly rate, APY (%)">
            <input name="apy" {...decimalInput} required placeholder="20" className={field} />
          </Field>
          <p className="mt-2 text-sm text-muted">
            APY is the effective rate for a whole year, with growth added on top of growth inside the product. It is not a
            monthly rate. Type the one the provider shows you.
          </p>
          <Field label="Takes effect on" className="mt-4">
            <input type="date" name="effectiveDate" required defaultValue={today} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save rate"}
          </button>
          <Saved show={saved}>Rate saved.</Saved>
        </>
      )}
    </Form>
  );
}

/** The actual value read off the product. It becomes the new starting point for the estimate. */
export function CloudConfirmForm({ holdingId, today }: { holdingId: string; today: string }) {
  return (
    <Form action={confirmCloudValue} reset>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="holdingId" value={holdingId} />
          <Field label="Actual value now (EGP)">
            <input name="value" {...decimalInput} required placeholder="0" className={field} />
          </Field>
          <p className="mt-2 text-sm text-muted">
            Type what the provider shows. It becomes the new starting point: the estimate grows from this value from now on.
          </p>
          <Field label="Value as of" className="mt-4">
            <input type="date" name="date" required max={today} defaultValue={today} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Confirm value"}
          </button>
          <Saved show={saved}>Value confirmed.</Saved>
        </>
      )}
    </Form>
  );
}

/** Dates and the planned contribution. The contribution only feeds the expected value; it never books money. */
export function CloudEditForm({
  holdingId,
  startDate,
  maturityDate,
  contributionAmount,
  contributionFrequency,
}: {
  holdingId: string;
  startDate: string | null;
  maturityDate: string | null;
  contributionAmount: number | null;
  contributionFrequency: "weekly" | "monthly" | null;
}) {
  return (
    <Form action={updateCloud}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="holdingId" value={holdingId} />
          <Field label="Start date">
            <input type="date" name="startDate" required defaultValue={startDate ?? ""} className={field} />
          </Field>
          <Field label="Maturity date (optional)" className="mt-4">
            <input type="date" name="maturityDate" defaultValue={maturityDate ?? ""} className={field} />
          </Field>
          <Field label="Planned contribution (EGP, optional)" className="mt-4">
            <input
              name="contributionAmount"
              {...decimalInput}
              placeholder="0"
              defaultValue={contributionAmount === null ? "" : egpText(contributionAmount)}
              className={field}
            />
          </Field>
          <Field label="How often" className="mt-4">
            <select name="contributionFrequency" defaultValue={contributionFrequency ?? ""} className={field}>
              <option value="">Not set</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </Field>
          <p className="mt-2 text-sm text-muted">Only used for the expected value. It does not record any money moving.</p>
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <Saved show={saved}>Saved.</Saved>
        </>
      )}
    </Form>
  );
}
