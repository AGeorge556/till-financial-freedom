"use client";

import { useState } from "react";
import { archiveAccount, setBalance, unarchiveAccount, updateAccount } from "@/app/actions/accounts";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/components/accountTypes";
import { Form } from "@/components/Form";
import { egpText } from "@/components/GoalFormat";
import { Field, field, primaryBtn, secondaryBtn } from "@/components/ui";

const savedNote = (saved: boolean) =>
  saved && (
    <p role="status" className="mt-3 text-positive">
      Saved.
    </p>
  );

/** Name, bank and notes, and what was fixed when the account was added: its type, opening balance and investment flag. */
export function EditAccountForm({
  id,
  name,
  institution,
  notes,
  type: savedType,
  openingBalance,
  isInvestment,
}: {
  id: string;
  name: string;
  institution: string | null;
  notes: string | null;
  type: AccountType;
  /** Signed piasters; negative only on a credit card (money owed). */
  openingBalance: number;
  isInvestment: boolean;
}) {
  const [type, setType] = useState<AccountType>(savedType);
  return (
    <Form action={updateAccount}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Name">
            <input name="name" autoComplete="off" required maxLength={80} defaultValue={name} className={field} />
          </Field>
          <Field label="Type" className="mt-4">
            <select name="type" value={type} onChange={(e) => setType(e.target.value as AccountType)} className={field}>
              {Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opening balance (EGP)" className="mt-4">
            <input
              name="openingBalance"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              defaultValue={egpText(Math.abs(openingBalance))}
              className={field}
            />
          </Field>
          <p className="mt-1 text-sm text-muted">
            What the account held on the day you started. Changing it changes today&apos;s balance by the same amount. To match today&apos;s
            balance, use Set balance instead.
          </p>
          {type === "credit_card" && (
            <label className="mt-3 flex min-h-11 items-center gap-3">
              <input type="checkbox" name="owed" defaultChecked={openingBalance <= 0} className="size-5" />I owe this amount
            </label>
          )}
          {type !== "brokerage" && (
            <label className="mt-3 flex min-h-11 items-center gap-3">
              <input type="checkbox" name="isInvestment" defaultChecked={isInvestment} className="size-5" />
              This account holds investments
            </label>
          )}
          <Field label="Bank or provider (optional)" className="mt-4">
            <input name="institution" autoComplete="off" defaultValue={institution ?? ""} className={field} />
          </Field>
          <Field label="Notes (optional)" className="mt-4">
            <input name="notes" autoComplete="off" defaultValue={notes ?? ""} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          {savedNote(saved)}
        </>
      )}
    </Form>
  );
}

export function SetBalanceForm({ id, isCreditCard }: { id: string; isCreditCard: boolean }) {
  return (
    <Form action={setBalance} reset>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="What is the balance now? (EGP)">
            <input name="balance" inputMode="decimal" autoComplete="off" placeholder="0" required className={field} />
          </Field>
          {isCreditCard && (
            <label className="mt-3 flex min-h-11 items-center gap-3">
              <input type="checkbox" name="owed" defaultChecked className="size-5" />I owe this amount
            </label>
          )}
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : "Set balance"}
          </button>
          {savedNote(saved)}
        </>
      )}
    </Form>
  );
}

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  return (
    <Form action={archived ? unarchiveAccount : archiveAccount}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending} className={`w-full ${secondaryBtn}`}>
            {pending ? "Saving…" : archived ? "Unarchive account" : "Archive account"}
          </button>
        </>
      )}
    </Form>
  );
}
