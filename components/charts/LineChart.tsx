"use client";

import type { Piasters } from "@/lib/finance-core/money";
import { Amount } from "../Amount";
import { formatDay } from "../dates";
import { HIDDEN_NOTE, type Token, useMoney } from "./chartParts";

const W = 320;
const H = 140;
const PAD = 6;
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dayYear = (date: string) => `${formatDay(date)} ${date.slice(0, 4)}`;

/** A step line: a value holds until the next dated point, it is never interpolated. One series, so no legend. */
export function LineChart({ name, points, token }: { name: string; points: { date: string; value: Piasters }[]; token: Token }) {
  const { hidden, money } = useMoney();
  if (points.length < 2) return <p className="text-muted">Not enough history yet to draw a chart.</p>;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  const min = lo - pad;
  const max = hi + pad;
  const first = points[0];
  const last = points[points.length - 1];
  const span = ms(last.date) - ms(first.date) || 1;
  const x = (date: string) => PAD + ((ms(date) - ms(first.date)) / span) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD);
  const path = points.reduce(
    (d, p, i) => (i === 0 ? `M${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}` : `${d}H${x(p.date).toFixed(1)}V${y(p.value).toFixed(1)}`),
    "",
  );
  const label = `${name} from ${dayYear(first.date)} to ${dayYear(last.date)}. ${
    hidden ? HIDDEN_NOTE : `Started at ${money(first.value)}, ended at ${money(last.value)}, lowest ${money(lo)}, highest ${money(hi)}.`
  }`;

  return (
    <figure>
      <figcaption className="flex flex-wrap justify-between gap-x-4 text-sm text-muted">
        <span>
          Highest <Amount value={hi} />
        </span>
        <span>
          Lowest <Amount value={lo} />
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="mt-2 h-auto w-full">
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={PAD + f * (H - 2 * PAD)} y2={PAD + f * (H - 2 * PAD)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {min < 0 && max > 0 && (
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        <path d={path} fill="none" stroke={`var(--${token})`} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
        <span>{dayYear(first.date)}</span>
        <span>{dayYear(last.date)}</span>
      </div>
      {hidden && <p className="mt-2 text-sm text-muted">{HIDDEN_NOTE}</p>}
      <table className="sr-only">
        <caption>{name} by date</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{name}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{dayYear(p.date)}</th>
              <td>
                <Amount value={p.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
