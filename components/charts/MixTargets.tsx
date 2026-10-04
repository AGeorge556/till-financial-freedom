"use client";

import { setPortfolioTargets } from "@/app/actions/settings";
import { MIX_CLASSES, MIX_LABELS, type MixClass, type TargetLine } from "@/lib/finance-core/portfolioMix";
import { Amount } from "../Amount";
import { Form } from "../Form";
import { Field, field, primaryBtn } from "../ui";

const pct = (fraction: number) => `${Number((fraction * 100).toFixed(2))}%`;

/** Current against target per class in plain words, then the form to set the targets. Information only: nothing is rebalanced. */
export function MixTargets({ lines, values }: { lines: TargetLine[] | null; values: Record<MixClass, string> }) {
  return (
    <div>
      {lines === null ? (
        <p className="text-muted">You have not set targets. Add them below to see how far each class is from where you want it.</p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((l) => (
            <li key={l.class} className="py-3">
              <p className="font-medium">{MIX_LABELS[l.class]}</p>
              <p className="text-sm text-muted">
                You have {pct(l.bps / 10000)}, your target is {pct(l.target)}.
              </p>
              <p className="text-sm">
                {l.direction === "on" ? (
                  "Right on your target."
                ) : (
                  <>
                    <Amount value={Math.abs(l.difference)} /> {l.direction} your target.
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 font-semibold">Your targets</h3>
      <Form action={setPortfolioTargets} className="mt-2">
        {({ pending, saved }) => (
          <>
            <p className="mb-3 text-sm text-muted">The four must add up to 100%. Leave all four blank to remove your targets.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {MIX_CLASSES.map((c) => (
                <Field key={c} label={`${MIX_LABELS[c]} (%)`}>
                  <input name={c} inputMode="decimal" autoComplete="off" placeholder="Not set" defaultValue={values[c]} className={field} />
                </Field>
              ))}
            </div>
            <button type="submit" disabled={pending} className={`mt-5 ${primaryBtn}`}>
              {pending ? "Saving…" : "Save targets"}
            </button>
            {saved && (
              <p role="status" className="mt-3 text-positive">
                Saved.
              </p>
            )}
          </>
        )}
      </Form>
      <p className="mt-4 text-sm text-muted">Nothing is rebalanced for you, and no buying or selling is suggested. Targets are only for comparison.</p>
    </div>
  );
}
