"use client";

import { useState } from "react";
import { createAccount } from "@/app/actions/accounts";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/components/accountTypes";
import { Form } from "@/components/Form";
import { Field, field, primaryBtn } from "@/components/ui";

export function AddAccountForm() {
  // Controlled so the "owed" checkbox can follow it; the first option is the default a form reset returns to.
  const [type, setType] = useState<AccountType>("bank");

  return (
    <Form action={createAccount} reset onSuccess={() => setType("bank")}>
      {({ pending, saved }) => (
        <>
          <Field label="Name">
            <input name="name" required maxLength={80} autoComplete="off" className={field} />
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
          <Field label="Balance today (EGP)" className="mt-4">
            <input name="openingBalance" inputMode="decimal" autoComplete="off" placeholder="0" className={field} />
          </Field>
          {type === "credit_card" && (
            <label className="mt-3 flex min-h-11 items-center gap-3">
              <input type="checkbox" name="owed" defaultChecked className="size-5" />I owe this amount
            </label>
          )}
          {type !== "brokerage" && (
            <label className="mt-3 flex min-h-11 items-center gap-3">
              <input type="checkbox" name="isInvestment" className="size-5" />
              This account holds investments
            </label>
          )}
          <Field label="Bank or provider (optional)" className="mt-4">
            <input name="institution" autoComplete="off" className={field} />
          </Field>
          <Field label="Notes (optional)" className="mt-4">
            <input name="notes" autoComplete="off" className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Adding…" : "Add account"}
          </button>
          {saved && (
            <p role="status" className="mt-3 text-positive">
              Account added.
            </p>
          )}
        </>
      )}
    </Form>
  );
}
