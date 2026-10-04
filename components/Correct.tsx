"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ActionState } from "@/app/actions/shared";
import { Form } from "./Form";
import { Sheet } from "./Sheet";
import type { AccountOption } from "./TransactionForm";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** What every Remove asks, in plain words. `noun` reads after "this": "price", "payment". */
export const removeConfirm = (noun: string) =>
  `Remove this ${noun}? It will no longer count. It stays in your history as removed.`;

/** The accounts a form may offer: the active ones, plus the archived one the entry being edited already uses. */
export const usableAccounts = (accounts: AccountOption[], keepId?: string | null) =>
  accounts.filter((a) => !a.archived || a.id === keepId);

/** Remove button for a sheet. `what` names the entry so several of them can be told apart by a screen reader. */
export function RemoveButton({
  action,
  id,
  noun,
  what,
  onDone,
}: {
  action: Action;
  id: string;
  noun: string;
  what: string;
  onDone?: () => void;
}) {
  return (
    <Form action={action} onSuccess={onDone} confirm={removeConfirm(noun)}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={pending}
            className="mt-3 min-h-11 w-full rounded-xl border border-border px-4 font-medium text-negative disabled:opacity-60"
          >
            {pending ? "Removing…" : "Remove"}
            <span className="sr-only"> {what}</span>
          </button>
        </>
      )}
    </Form>
  );
}

export const RemovedTag = () => (
  <span className="ml-2 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-normal text-muted">Removed</span>
);

/**
 * Opens a sheet for one item and gives focus back afterwards: to the same row if it is still there, else to the list
 * (an edit replaces the row, so it usually has a new key).
 */
export function useEntrySheet<T>(keyOf: (item: T) => string) {
  const [selected, setSelected] = useState<T | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const lastKey = useRef("");
  return {
    selected,
    listRef,
    open(item: T) {
      lastKey.current = keyOf(item);
      setSelected(item);
    },
    close() {
      setSelected(null);
      const key = lastKey.current;
      setTimeout(() => {
        const root = listRef.current;
        const row = root ? Array.from(root.querySelectorAll<HTMLElement>("[data-entry-key]")).find((el) => el.dataset.entryKey === key) : null;
        (row ?? root)?.focus();
      }, 0);
    },
  };
}

/** "Show removed (N)": removed entries come back greyed out and labelled, and never count. */
export function RemovedToggle({ count, shown, onToggle }: { count: number; shown: boolean; onToggle: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      className="mt-3 min-h-11 rounded-xl border border-border px-4 text-sm font-medium"
    >
      {shown ? "Hide removed" : `Show removed (${count})`}
    </button>
  );
}

export type Entry = { key: string; removed: boolean };

/**
 * One history list. A row opens its sheet (the same form used to create that kind of entry, filled in). Removed entries
 * are hidden behind "Show removed (N)".
 */
export function EntryList<T extends Entry>({
  entries,
  row,
  name,
  title,
  sheet,
  editable = () => true,
  empty = "Nothing recorded yet.",
  limit,
  className = "",
}: {
  entries: T[];
  /** The visible content of a row. */
  row: (entry: T) => ReactNode;
  /** What a screen reader hears after "Edit": "buy of 3 Oct 2026". */
  name: (entry: T) => string;
  title: (entry: T) => string;
  sheet: (entry: T, done: () => void) => ReactNode;
  /** False for an entry that cannot be corrected on its own. */
  editable?: (entry: T) => boolean;
  empty?: string;
  /** Show only the newest few until "Show all" is tapped. */
  limit?: number;
  className?: string;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [all, setAll] = useState(false);
  const { selected, listRef, open, close } = useEntrySheet<T>((e) => e.key);
  const removed = entries.filter((e) => e.removed).length;
  const visible = showRemoved ? entries : entries.filter((e) => !e.removed);
  const shown = limit && !all ? visible.slice(0, limit) : visible;

  return (
    <div className={className}>
      {visible.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul
          ref={(el) => {
            listRef.current = el;
          }}
          tabIndex={-1}
          className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface outline-none"
        >
          {shown.map((e) => (
            <li key={e.key}>
              {e.removed ? (
                <div className="px-4 py-3 opacity-60">
                  {row(e)}
                  <p className="mt-1 text-sm">
                    <RemovedTag />
                  </p>
                </div>
              ) : !editable(e) ? (
                <div className="px-4 py-3">{row(e)}</div>
              ) : (
                <button
                  type="button"
                  data-entry-key={e.key}
                  onClick={() => open(e)}
                  aria-haspopup="dialog"
                  className="block min-h-14 w-full px-4 py-3 text-left"
                >
                  <span className="sr-only">Edit {name(e)}: </span>
                  {row(e)}
                  <span aria-hidden="true" className="mt-1 block text-sm text-muted underline">
                    Edit or remove
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {limit && visible.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 mr-3 min-h-11 rounded-xl border border-border px-4 text-sm font-medium">
          {all ? "Show fewer" : `Show all (${visible.length})`}
        </button>
      )}
      <RemovedToggle count={removed} shown={showRemoved} onToggle={() => setShowRemoved((v) => !v)} />
      <Sheet open={selected !== null} onClose={close} label={selected ? title(selected) : "Edit"}>
        {selected && (
          <>
            <h2 className="mr-11 mb-5 text-lg font-semibold tracking-tight">{title(selected)}</h2>
            {sheet(selected, close)}
          </>
        )}
      </Sheet>
    </div>
  );
}
