"use client";

import { useActionState } from "react";
import { importBackup, type ImportState } from "@/app/actions/backup";
import { BackLink } from "@/components/ui";

const link = "flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-4 font-medium";

export default function Page() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importBackup, {});

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Backup</h1>
      <p className="mt-2 text-muted">
        The backup is a file with every account, category and transaction, including voided ones. Keep a copy
        somewhere other than this phone, and download a fresh one after you add data.
      </p>

      <div className="mt-6 grid gap-3">
        <a href="/more/backup/export?format=json" download className={link}>
          Download full backup (JSON)
        </a>
        <a href="/more/backup/export?format=csv" download className={link}>
          Download transactions (CSV)
        </a>
      </div>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Restore</h2>
      <p className="mt-1 text-muted">
        Restoring only works on an empty account. It never merges with or replaces existing data.
      </p>
      <form action={action} className="mt-4">
        <label htmlFor="file" className="text-sm text-muted">
          Backup file
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".json"
          required
          aria-describedby={state.error ? "restore-error" : undefined}
          aria-invalid={state.error ? true : undefined}
          className="mt-2 block min-h-11 w-full rounded-xl border border-control bg-surface px-4 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="mt-4 min-h-11 w-full rounded-xl bg-foreground px-4 font-semibold text-background disabled:opacity-60"
        >
          {pending ? "Restoring…" : "Restore backup"}
        </button>
      </form>

      <p id="restore-error" role="alert" className={state.error ? "mt-4 text-negative" : "sr-only"}>
        {state.error}
      </p>
      <p role="status" className={state.imported ? "mt-4 text-positive" : "sr-only"}>
        {state.imported &&
          `Restored ${state.imported.accounts} accounts, ${state.imported.categories} categories and ${state.imported.transactions} transactions.`}
      </p>
    </>
  );
}
