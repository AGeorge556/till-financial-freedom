"use client";

import { useState } from "react";
import { addCategory, archiveCategory, renameCategory, setEssential } from "@/app/actions/categories";
import { Form } from "@/components/Form";
import { Field, field, primaryBtn, secondaryBtn } from "@/components/ui";

export function AddCategoryForm() {
  // Controlled so the "essential" box shows only for expenses; "expense" is the first option, the reset default.
  const [kind, setKind] = useState("expense");

  return (
    <Form action={addCategory} reset onSuccess={() => setKind("expense")}>
      {({ pending, saved }) => (
        <>
          <Field label="Name">
            <input name="name" required maxLength={80} autoComplete="off" className={field} />
          </Field>
          <Field label="Kind" className="mt-4">
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
              <option value="expense">Spending</option>
              <option value="income">Income</option>
            </select>
          </Field>
          {kind === "expense" && (
            <label className="mt-3 flex min-h-11 items-center gap-3">
              <input type="checkbox" name="isEssential" className="size-5" />
              Essential (rent, bills, food)
            </label>
          )}
          <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
            {pending ? "Adding…" : "Add category"}
          </button>
          {saved && (
            <p role="status" className="mt-3 text-positive">
              Category added.
            </p>
          )}
        </>
      )}
    </Form>
  );
}

export function CategoryRow({ id, name, isEssential, isExpense }: { id: string; name: string; isEssential: boolean; isExpense: boolean }) {
  return (
    <div className="px-4 py-3">
      <Form action={renameCategory} className="flex gap-2">
        {({ pending, saved }) => (
          <>
            <input type="hidden" name="id" value={id} />
            <input
              name="name"
              aria-label="Category name"
              required
              maxLength={80}
              defaultValue={name}
              className={`${field} mt-0 min-w-0 flex-1`}
            />
            <button type="submit" disabled={pending} className={secondaryBtn}>
              {saved ? "Saved" : "Rename"}
            </button>
          </>
        )}
      </Form>

      <div className="mt-1 flex items-center justify-between gap-3">
        {isExpense ? (
          <Form action={setEssential}>
            {() => (
              <>
                <input type="hidden" name="id" value={id} />
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="isEssential"
                    defaultChecked={isEssential}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="size-5"
                  />
                  Essential
                </label>
              </>
            )}
          </Form>
        ) : (
          <span />
        )}
        <Form
          action={archiveCategory}
          confirm={`Archive "${name}"? It will no longer be offered when you add transactions.`}
        >
          {({ pending }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <button type="submit" disabled={pending} className="min-h-11 px-2 text-sm text-muted underline disabled:opacity-60">
                Archive
              </button>
            </>
          )}
        </Form>
      </div>
    </div>
  );
}
