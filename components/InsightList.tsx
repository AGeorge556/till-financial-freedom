import { Fragment } from "react";
import type { Insight, InsightInputValue, TextPart } from "@/lib/finance-core/insights";
import { Amount } from "./Amount";
import { monthsText } from "./GoalFormat";

/** A sentence made of text and amounts; amounts go through Amount so privacy mode hides them. */
export function TextParts({ parts }: { parts: TextPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{"amount" in p ? <Amount value={p.amount} /> : p.text}</Fragment>
      ))}
    </>
  );
}

function InputValue({ input }: { input: InsightInputValue }) {
  switch (input.unit) {
    case "egp":
      return <Amount value={input.value} />;
    case "percent":
      return <>{Number((input.value * 100).toFixed(1))}%</>;
    case "months":
      return <>{monthsText(input.value)}</>;
    case "days":
      return <>{input.value === 1 ? "1 day" : `${input.value} days`}</>;
    case "count":
      return <>{input.value}</>;
  }
}

const MARK = {
  good: { glyph: "✓", tone: "text-positive", word: "Good news. " },
  warning: { glyph: "▲", tone: "text-spending", word: "Worth a look. " },
  info: { glyph: "•", tone: "text-muted", word: "For your information. " },
} as const;

/** Each insight is one sentence; tapping it opens the numbers behind it and how they were worked out. */
export function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <p className="text-muted">
        Nothing stands out right now. Comparisons with your usual spending start once you have two full months of history.
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {insights.map((i) => {
          const mark = MARK[i.severity];
          return (
            <li key={i.id}>
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className={`mt-0.5 w-4 shrink-0 text-center ${mark.tone}`}>
                    {mark.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">{mark.word}</span>
                    <TextParts parts={i.text} />
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <div className="border-t border-border bg-background px-4 py-3 text-sm">
                  <dl className="space-y-1">
                    {i.inputs.map((input) => (
                      <div key={input.label} className="flex items-baseline justify-between gap-4">
                        <dt className="text-muted">{input.label}</dt>
                        <dd className="text-right font-medium">
                          <InputValue input={input} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-muted">
                    <span className="font-medium text-foreground">How this was worked out. </span>
                    {i.formula}
                  </p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm text-muted">Tap one to see its numbers and how it was worked out.</p>
    </>
  );
}
