"use client";

import { archiveAccount, setBalance, unarchiveAccount, updateAccount } from "@/app/actions/accounts";
import { Form } from "@/components/Form";
import { Field, field, primaryBtn, secondaryBtn } from "@/components/ui";

const savedNote = (saved: boolean) =>
  saved && (
    <p role="status" className="mt-3 text-positive">
      Saved.
    </p>
  );

export function EditAccountForm({
  id,
  name,
  institution,
  notes,
}: {
  id: string;
  name: string;
  institution: string | null;
  notes: string | null;
}) {
  return (
    <Form action={updateAccount}>
      {({ pending, saved }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Name">
            <input name="name" autoComplete="off" required maxLength={80} defaultValue={name} className={field} />
          </Field>
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
