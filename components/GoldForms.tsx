"use client";

import { useState } from "react";
import { addGoldPrice } from "@/app/actions/gold";
import { type GoldPriceMode, type Karat, karatPrice, KARATS } from "@/lib/finance-core/gold";
import { Form } from "./Form";
import { plain } from "./HoldingFormat";
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

/** One buy-back price for one karat. In derive mode the other karats are shown as they follow from it. */
function KaratPriceForm({ karat, derive, today }: { karat: Karat; derive: boolean; today: string }) {
  const [price, setPrice] = useState("");
  const d21 = derive ? derivedPrice(price, 21) : null;
  const d18 = derive ? derivedPrice(price, 18) : null;
  return (
    <Form action={addGoldPrice} reset onSuccess={() => setPrice("")}>
      {({ pending, saved }) => (
        <>
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
            <input type="date" name="date" required max={today} defaultValue={today} className={field} />
          </Field>
          <button type="submit" disabled={pending} className={`mt-4 ${primaryBtn}`}>
            {pending ? "Saving…" : `Save ${karat}K price`}
          </button>
          <Saved show={saved}>Price saved.</Saved>
        </>
      )}
    </Form>
  );
}

/**
 * Gold prices are global, not per holding, and are the BUY-BACK price (what a jeweler pays you), not the shop price.
 * derive_24k: one field. per_karat: one field per karat. A price is only ever added, never edited.
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
