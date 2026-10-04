"use client";

import { useState } from "react";
import { addGoldPrice, editGoldPrice, removeGoldPrice } from "@/app/actions/gold";
import type { GoldPriceEntry } from "@/db/queries";
import { type GoldPriceMode, type Karat, karatPrice, KARATS } from "@/lib/finance-core/gold";
import { EntryList, RemoveButton } from "./Correct";
import { Form } from "./Form";
import { dateText, plain, typed } from "./HoldingFormat";
import { decimalInput, Saved } from "./HoldingForms";
import { HoldingPrivate } from "./HoldingPrivate";
import { Field, field, primaryBtn } from "./ui";

/** The derived price as the engine computes it, or null while the typed price is not a valid one. */
function derivedPrice(price: string, karat: Karat): string | null {
  try {
    return plain(karatPrice(price.trim(), karat));
  } catch {
    return null;
  }
}

type GoldPriceEditing = { id: string; price: string; date: string; what: string };

/** One buy-back price for one karat, or with `editing` a correction of a saved one. In derive mode the other karats are shown as they follow from it. */
function KaratPriceForm({
  karat,
  derive,
  today,
  editing,
  onDone,
}: {
  karat: Karat;
  derive: boolean;
  today: string;
  editing?: GoldPriceEditing;
  onDone?: () => void;
}) {
  const [price, setPrice] = useState(editing ? typed(editing.price) : "");
  const d21 = derive ? derivedPrice(price, 21) : null;
  const d18 = derive ? derivedPrice(price, 18) : null;
  return (
    <>
    <Form
      action={editing ? editGoldPrice : addGoldPrice}
      reset={!editing}
      onSuccess={() => {
        setPrice("");
        onDone?.();
      }}
    >
      {({ pending, saved }) => (
        <>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <input type="hidden" name="karat" value={karat} />
          <Field label={`${karat}K buy-back price per gram (EGP)`}>
            <input
              name="price"
              {...decimalInput}
              required
              placeholder="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={field}
            />
          </Field>
          {derive && (
            <p aria-live="polite" className="mt-2 min-h-6 text-sm text-muted">
              {d21 !== null && d18 !== null && (
                <>
                  21K follows as <HoldingPrivate>{d21}</HoldingPrivate> and 18K as <HoldingPrivate>{d18}</HoldingPrivate> EGP per
                  gram.
                </>
              )}
            </p>
          )}
          <Field label="Price date" className="mt-4">
            <input type="date" name="date" required max={today} defaultValue={editing?.date ?? today} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : editing ? "Save" : `Save ${karat}K price`}
          </button>
          {!editing && <Saved show={saved}>Price saved.</Saved>}
        </>
      )}
    </Form>
    {editing && <RemoveButton action={removeGoldPrice} id={editing.id} noun="price" what={editing.what} onDone={onDone} />}
    </>
  );
}

/**
 * Gold prices are global, not per holding, and are the BUY-BACK price (what a jeweler pays you), not the shop price.
 * derive_24k: one field. per_karat: one field per karat. A saved price is corrected from the list below it.
 */
export function GoldPriceForm({ mode, today }: { mode: GoldPriceMode; today: string }) {
  if (mode === "derive_24k") return <KaratPriceForm karat={24} derive today={today} />;
  return (
    <div className="space-y-6">
      {KARATS.map((k) => (
        <KaratPriceForm key={k} karat={k} derive={false} today={today} />
      ))}
    </div>
  );
}

/** The saved prices, newest first (the latest few until "Show all"). Each opens for correction; removed ones sit behind "Show removed". */
export function GoldPriceHistory({
  prices,
  removed,
  mode,
  today,
}: {
  prices: GoldPriceEntry[];
  removed: GoldPriceEntry[];
  mode: GoldPriceMode;
  today: string;
}) {
  const entries = [
    ...prices.map((p) => ({ ...p, key: p.id, removed: false })),
    ...removed.map((p) => ({ ...p, key: p.id, removed: true })),
  ].sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  const what = (p: { karat: Karat; date: string }) => `${p.karat}K price of ${dateText(p.date)}`;
  return (
    <EntryList
      className="mt-4"
      entries={entries}
      limit={8}
      empty="No gold prices entered yet."
      name={what}
      title={(p) => `Edit ${what(p)}`}
      row={(p) => (
        <span className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted">
            {dateText(p.date)} · {p.karat}K
          </span>
          <HoldingPrivate>{plain(p.price)} EGP per gram</HoldingPrivate>
        </span>
      )}
      sheet={(p, done) => (
        <KaratPriceForm
          karat={p.karat}
          derive={mode === "derive_24k" && p.karat === 24}
          today={today}
          editing={{ id: p.id, price: p.price, date: p.date, what: what(p) }}
          onDone={done}
        />
      )}
    />
  );
}
