"use client";

import Link from "next/link";
import { useState } from "react";
import {
  addLiabilityUpdate,
  archiveLiability,
  createLiability,
  recordPayment,
  unarchiveLiability,
  updateLiability,
  voidPayment,
} from "@/app/actions/liabilities";
import { parseEGP } from "@/lib/finance-core/money";
import { Amount } from "./Amount";
import { Form } from "./Form";
import { ratePercentText } from "./GoalFormat";
import { decimalInput, Saved } from "./HoldingForms";
import type { AccountOption, CategoryOption } from "./TransactionForm";
import { Field, field, primaryBtn, secondaryBtn } from "./ui";

const KINDS = [
  { value: "loan", label: "Loan" },
  { value: "owed", label: "Money I owe someone" },
  { value: "other", label: "Other" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

function KindSelect({ defaultValue }: { defaultValue: Kind }) {
  return (
    <Field label="Type" className="mt-4">
      <select name="kind" defaultValue={defaultValue} className={field}>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function AddLoanForm({ today }: { today: string }) {
  return (
    <Form action={createLiability} reset>
      {({ pending, saved }) => (
        <>
          <Field label="Name">
            <input name="name" required maxLength={80} autoComplete="off" className={field} />
          </Field>
          <KindSelect defaultValue="loan" />
          <Field label="What you owe now (EGP)" className="mt-4">
            <input name="openingBalance" {...decimalInput} required placeholder="0" className={field} />
          </Field>
          <Field label="Yearly interest rate in % (optional)" className="mt-4">
            <input name="interestRate" {...decimalInput} placeholder="Not set" className={field} />
          </Field>
          <p className="mt-1 text-sm text-muted">Shown for your reference only. Nothing is calculated from it: you type the interest of each payment.</p>
          <Field label="Start date" className="mt-4">
            <input type="date" name="startDate" required defaultValue={today} className={field} />
          </Field>
          <Field label="Notes (optional, no amounts)" className="mt-4">
            <input name="notes" maxLength={1000} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Adding…" : "Add loan"}
          </button>
          <Saved show={saved}>Loan added.</Saved>
        </>
      )}
    </Form>
  );
}

/** One payment: the principal reduces the loan (not spending), the interest is an expense. Both are written together. */
export function PaymentForm({
  liabilityId,
  accounts,
  categories,
  today,
}: {
  liabilityId: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const p = parseEGP(principal);
  const i = interest.trim() === "" ? 0 : parseEGP(interest);
  const expense = categories.filter((c) => c.kind === "expense" && !c.archived);

  return (
    <Form
      action={recordPayment}
      reset
      onSuccess={() => {
        setPrincipal("");
        setInterest("");
      }}
    >
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="liabilityId" value={liabilityId} />
          <p className="mb-4 text-sm text-muted">
            The principal reduces the loan and is not spending. The interest is spending.
          </p>
          <Field label="Principal paid (EGP)">
            <input
              name="principal"
              {...decimalInput}
              required
              placeholder="0"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              className={field}
            />
          </Field>
          <Field label="Interest paid (EGP, optional)" className="mt-4">
            <input name="interest" {...decimalInput} placeholder="0" value={interest} onChange={(e) => setInterest(e.target.value)} className={field} />
          </Field>
          <p aria-live="polite" className="mt-3 min-h-6 text-sm">
            {p !== null && p > 0 && (
              <>
                <span className="text-muted">Reduces the loan by </span>
                <Amount value={p} showPiasters className="font-semibold" />
              </>
            )}
            {i !== null && i > 0 && (
              <>
                <span className="text-muted">
                  {p !== null && p > 0 ? ", and counts as spending: " : "Counts as spending: "}
                </span>
                <Amount value={i} showPiasters className="font-semibold" />
              </>
            )}
          </p>
          {i !== null && i > 0 && (
            <Field label="Expense category for the interest" className="mt-2">
              {expense.length === 0 ? (
                <p className="mt-2 text-muted">
                  You have no expense categories.{" "}
                  <Link href="/more/categories" className="underline">
                    Add one in More &gt; Categories
                  </Link>
                  .
                </p>
              ) : (
                <select name="categoryId" required defaultValue={expense[0].id} className={field}>
                  {expense.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Paid from" className="mt-4">
            <select name="accountId" required className={field}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" className="mt-4">
            <input type="date" name="date" required defaultValue={today} className={field} />
          </Field>
          <Field label="Note (optional, no amounts)" className="mt-4">
            <input name="note" maxLength={500} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Record payment"}
          </button>
          <Saved show={saved}>Payment recorded.</Saved>
        </>
      )}
    </Form>
  );
}

/** Borrowed more, or a correction: moves no cash. */
export function LiabilityUpdateForm({ liabilityId, today }: { liabilityId: string; today: string }) {
  return (
    <Form action={addLiabilityUpdate} reset>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="liabilityId" value={liabilityId} />
          <Field label="What changed">
            <select name="direction" defaultValue="more" className={field}>
              <option value="more">I owe more (borrowed more)</option>
              <option value="less">I owe less (a correction)</option>
            </select>
          </Field>
          <Field label="By how much (EGP)" className="mt-4">
            <input name="amount" {...decimalInput} required placeholder="0" className={field} />
          </Field>
          <p className="mt-2 text-sm text-muted">This moves no cash and touches no account. If you paid something, use Record a payment.</p>
          <Field label="Date" className="mt-4">
            <input type="date" name="date" required defaultValue={today} className={field} />
          </Field>
          <Field label="Note (optional, no amounts)" className="mt-4">
            <input name="note" maxLength={500} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-6 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save update"}
          </button>
          <Saved show={saved}>Update saved.</Saved>
        </>
      )}
    </Form>
  );
}

/** Name, type, rate, start date and notes. What you owe changes only through payments and updates. */
export function EditLoanForm({
  id,
  name,
  kind,
  interestRate,
  startDate,
  notes,
}: {
  id: string;
  name: string;
  kind: Kind;
  interestRate: number | null;
  startDate: string;
  notes: string | null;
}) {
  return (
    <Form action={updateLiability}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Name">
            <input name="name" required maxLength={80} defaultValue={name} className={field} />
          </Field>
          <KindSelect defaultValue={kind} />
          <Field label="Yearly interest rate in % (optional)" className="mt-4">
            <input name="interestRate" {...decimalInput} placeholder="Not set" defaultValue={ratePercentText(interestRate)} className={field} />
          </Field>
          <Field label="Start date" className="mt-4">
            <input type="date" name="startDate" required defaultValue={startDate} className={field} />
          </Field>
          <Field label="Notes (optional, no amounts)" className="mt-4">
            <input name="notes" maxLength={1000} defaultValue={notes ?? ""} className={field} />
          </Field>
          <p className="mt-2 text-sm text-muted">Notes show even when amounts are hidden, so keep numbers out of them.</p>
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <Saved show={saved}>Saved.</Saved>
        </>
      )}
    </Form>
  );
}

export function LiabilityArchiveButton({ id, archived, canArchive }: { id: string; archived: boolean; canArchive: boolean }) {
  return (
    <Form action={archived ? unarchiveLiability : archiveLiability}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending || (!archived && !canArchive)} className={`w-full ${secondaryBtn}`}>
            {archived ? "Restore loan" : "Archive loan"}
          </button>
        </>
      )}
    </Form>
  );
}

export function LiabilityVoidButton({ id }: { id: string }) {
  return (
    <Form action={voidPayment} confirm="Void this payment? It stays in your history but stops counting. The principal and the interest are both voided, and your cash balance is corrected.">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl px-3 text-sm font-medium text-negative disabled:opacity-60">
            {pending ? "Voiding…" : "Void"}
          </button>
        </>
      )}
    </Form>
  );
}
