"use client";

import { useId, useState, type ReactNode } from "react";
import { futureValue, goalStatus, requiredMonthlyContribution } from "@/lib/finance-core/projection";
import { parseEGP, type Piasters } from "@/lib/finance-core/money";
import { financialMonth, monthsRemaining } from "@/lib/finance-core/time";
import { Amount } from "./Amount";
import { formatMonthYear } from "./dates";
import { egpText, formatRate, monthsLateText, ratePercentText, shiftMonth } from "./GoalFormat";
import { usePrivacy } from "./PrivacyProvider";
import { field, secondaryBtn } from "./ui";

export type WhatIfProps = {
  target: Piasters;
  current: Piasters;
  /** The plan as it stands today. */
  plannedMonthly: Piasters;
  annualReturn: number;
  /** Saving dates left until the target date, as the page computed them. */
  monthsRemaining: number;
  targetDate: string;
  today: string;
  startDay: number;
  contributedThisMonth: boolean;
};

const MAX_DELAY = 60;
const MAX_POINTS = 360;

function parseReturn(text: string): number | null {
  if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(text.trim())) return null;
  const pct = Number(text);
  return pct >= -50 && pct <= 100 ? pct / 100 : null;
}

function parseDelay(text: string): number | null {
  return /^\d{1,2}$/.test(text.trim()) && Number(text) <= MAX_DELAY ? Number(text) : null;
}

/** The target date moved by whole months; a day past the end of the new month (31 Jan + 1) lands on its last day. */
function shiftDate(date: string, months: number): string {
  const key = shiftMonth(date.slice(0, 7), months);
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}

function Control({
  label,
  text,
  onText,
  invalid,
  range,
  inputMode,
  masked,
}: {
  label: string;
  text: string;
  onText: (t: string) => void;
  invalid: boolean;
  range: { min: number; max: number; step: number; value: number };
  inputMode: "decimal" | "numeric";
  /** Privacy mode: no slider (its position would show the amount) and the typed figure is dotted out. */
  masked?: boolean;
}) {
  const id = useId();
  return (
    <div className="mt-5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {masked ? (
          <p className="min-w-0 flex-1 text-sm text-muted">Amounts are hidden, so there is no slider. Type an amount.</p>
        ) : (
          <input
            type="range"
            aria-label={`${label}, slider`}
            min={range.min}
            max={range.max}
            step={range.step}
            value={Math.min(range.max, Math.max(range.min, range.value))}
            onChange={(e) => onText(e.target.value)}
            className="h-11 min-w-0 flex-1 accent-goals"
          />
        )}
        <input
          id={id}
          type={masked ? "password" : "text"}
          inputMode={inputMode}
          autoComplete="off"
          value={text}
          onChange={(e) => onText(e.target.value)}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className={`${field} mt-0 w-28 shrink-0`}
        />
      </div>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-sm text-negative">
          That is not a usable number. The results below still use the last good one.
        </p>
      )}
    </div>
  );
}

export function GoalWhatIf(p: WhatIfProps) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pmtText, setPmtText] = useState(egpText(p.plannedMonthly));
  const [returnText, setReturnText] = useState(ratePercentText(p.annualReturn));
  const [delayText, setDelayText] = useState("0");
  const { hidden } = usePrivacy();

  const pmtParsed = parseEGP(pmtText);
  const returnParsed = parseReturn(returnText);
  const delayParsed = parseDelay(delayText);
  const pmt = pmtParsed ?? p.plannedMonthly;
  const annual = returnParsed ?? p.annualReturn;
  const delay = delayParsed ?? 0;

  const monthKey = financialMonth(p.today, p.startDay).start.slice(0, 7);
  const dd = String(p.startDay).padStart(2, "0");
  const firstOffset = p.contributedThisMonth ? 1 : 0;

  function run(monthly: Piasters, rate: number, extra: number) {
    // A delay moves the target date, so month-end days and a date already past give the engine's answer.
    const n =
      extra === 0
        ? p.monthsRemaining
        : monthsRemaining(p.today, shiftDate(p.targetDate, extra), p.startDay, p.contributedThisMonth);
    const status = goalStatus(p.target, p.current, monthly, rate, n);
    const req = requiredMonthlyContribution(p.target, p.current, rate, n);
    const months = status.monthsLate === null ? null : status.monthsLate + n;
    return { n, status, req, months };
  }
  const base = run(p.plannedMonthly, p.annualReturn, 0);
  const alt = run(pmt, annual, delay);

  /** The m-th saving date is the end of the (m-1)th financial month after the first one still open. */
  function finishLabel(months: number | null): string {
    if (p.current >= p.target) return "Already reached";
    if (months === null) return "Not reached at this pace";
    const key = shiftMonth(monthKey, firstOffset + months - 1);
    return formatMonthYear(financialMonth(`${key}-${dd}`, p.startDay).end);
  }

  const required = (r: ReturnType<typeof run>): ReactNode =>
    r.req.kind === "target-date-passed" ? "Target date has passed" : r.req.monthly === 0 ? "Nothing more needed" : <Amount value={r.req.monthly} />;
  const lateness = (r: ReturnType<typeof run>) =>
    p.current >= p.target ? "Already reached" : r.n === 0 ? "Target date has passed" : monthsLateText(r.status.monthsLate);
  const targetMonth = formatMonthYear(shiftDate(p.targetDate, delay));

  const rows: { label: string; base: ReactNode; alt: ReactNode }[] = [
    { label: "Projected value at the target date", base: <Amount value={base.status.projected} />, alt: <Amount value={alt.status.projected} /> },
    { label: "Projected finish", base: finishLabel(base.months), alt: finishLabel(alt.months) },
    { label: "Against the target date", base: lateness(base), alt: lateness(alt) },
    { label: "Monthly amount needed to reach your goal", base: required(base), alt: required(alt) },
  ];

  // Projected balance month by month, with today at month 0.
  const horizon = Math.max(1, Math.min(MAX_POINTS, Math.max(alt.n, alt.months ?? 0)));
  const values = Array.from({ length: horizon + 1 }, (_, m) => futureValue(p.current, pmt, annual, m));
  const top = Math.max(p.target, ...values);
  const bottom = Math.min(0, ...values);
  const W = 320;
  const H = 150;
  const x = (m: number) => (m / horizon) * W;
  const y = (v: number) => H - ((v - bottom) / (top - bottom || 1)) * H;
  const line = values.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const reaches = alt.months !== null || p.current >= p.target;
  const description = reaches
    ? `The projected balance rises from where you are today and reaches the target line around ${finishLabel(alt.months)}.`
    : "The projected balance does not reach the target line within the period shown.";

  function reset() {
    setPmtText(egpText(p.plannedMonthly));
    setReturnText(ratePercentText(p.annualReturn));
    setDelayText("0");
  }

  const maxPmt = Math.max(10_000, Math.ceil((2 * Math.max(p.plannedMonthly, base.req.kind === "required" ? base.req.monthly : 0)) / 100 / 1000) * 1000);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-full ${secondaryBtn}`}
      >
        {open ? "Hide the what-if calculator" : "Try different numbers"}
      </button>

      {open && (
        <div className="mt-4">
          <p className="text-sm text-muted">
            These are assumptions, not guarantees. Nothing here is saved or changes your plan. The current plan assumes{" "}
            {formatRate(p.annualReturn)} a year.
          </p>

          <Control
            label="Monthly amount set aside (EGP)"
            text={pmtText}
            onText={setPmtText}
            invalid={pmtParsed === null}
            masked={hidden}
            inputMode="decimal"
            range={{ min: 0, max: maxPmt, step: 100, value: pmtParsed === null ? 0 : Math.round(pmtParsed / 100) }}
          />
          <Control
            label="Expected yearly return (%)"
            text={returnText}
            onText={setReturnText}
            invalid={returnParsed === null}
            inputMode="decimal"
            range={{ min: 0, max: 30, step: 0.5, value: returnParsed === null ? 0 : returnParsed * 100 }}
          />
          <Control
            label="Delay the target date (months)"
            text={delayText}
            onText={setDelayText}
            invalid={delayParsed === null}
            inputMode="numeric"
            range={{ min: 0, max: MAX_DELAY, step: 1, value: delay }}
          />
          <p className="mt-1 text-sm text-muted">Target date used: {targetMonth}.</p>

          <div aria-live="polite" className="mt-4 divide-y divide-border border-t border-border">
            {rows.map((r) => (
              <div key={r.label} className="py-3">
                <p className="text-sm text-muted">{r.label}</p>
                <div className="mt-1 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted">Current plan</p>
                    <p className="font-medium">{r.base}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">What if</p>
                    <p className="font-semibold">{r.alt}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <figure className="mt-4">
            <svg viewBox={`-4 -4 ${W + 8} ${H + 24}`} role="img" aria-labelledby={titleId} className="w-full">
              <title id={titleId}>Projected balance by month against the target</title>
              <desc>{description}</desc>
              <line x1="0" x2={W} y1={y(p.target)} y2={y(p.target)} className="stroke-muted" strokeDasharray="4 4" />
              {alt.n <= horizon && (
                <line x1={x(alt.n)} x2={x(alt.n)} y1="0" y2={H} className="stroke-muted" strokeDasharray="1 4" />
              )}
              <polyline points={line} fill="none" className="stroke-goals" strokeWidth="2.5" strokeLinejoin="round" />
              <text x="0" y={H + 16} className="fill-muted" fontSize="11">
                Today
              </text>
              <text x={W} y={H + 16} textAnchor="end" className="fill-muted" fontSize="11">
                {formatMonthYear(`${shiftMonth(monthKey, firstOffset + horizon - 1)}-01`)}
              </text>
            </svg>
            <figcaption className="text-sm text-muted">
              Solid line: projected balance. Dashed line: your target. Dotted line: the target date.
            </figcaption>
          </figure>

          <button type="button" onClick={reset} className={`mt-4 ${secondaryBtn}`}>
            Reset to the current plan
          </button>
        </div>
      )}
    </div>
  );
}
