"use client";

import type { Piasters } from "@/lib/finance-core/money";
import { Amount } from "../Amount";
import { HIDDEN_NOTE, type Token, useMoney } from "./chartParts";

const W = 320;
const H = 150;
const PAD = 6;
const LABEL_H = 16;

/** One bar per label, up from a zero line (down when negative). Text alternative: the table below. */
export function BarChart({
  name,
  xTitle,
  bars,
  token,
}: {
  name: string;
  xTitle: string;
  bars: { label: string; value: Piasters }[];
  token: Token;
}) {
  const { hidden, money } = useMoney();
  if (bars.length < 2) return <p className="text-muted">Not enough data to draw a chart.</p>;

  const values = bars.map((b) => b.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const top = Math.max(0, hi);
  const range = top - Math.min(0, lo) || 1;
  const plotH = H - 2 * PAD - LABEL_H;
  const y = (v: number) => PAD + ((top - v) / range) * plotH;
  const slot = (W - 2 * PAD) / bars.length;
  const step = Math.ceil(bars.length / 10);
  const label = `${name} by ${xTitle.toLowerCase()}, ${bars.length} bars from ${bars[0].label} to ${bars[bars.length - 1].label}. ${
    hidden ? HIDDEN_NOTE : `Lowest ${money(lo)}, highest ${money(hi)}.`
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
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {bars.map((b, i) => {
          const barH = Math.max(1, Math.abs(y(b.value) - y(0)));
          const cx = PAD + slot * i + slot / 2;
          return (
            <g key={b.label}>
              <rect x={cx - slot * 0.35} y={b.value >= 0 ? y(0) - barH : y(0)} width={slot * 0.7} height={barH} fill={`var(--${token})`} />
              {(i % step === 0 || i === bars.length - 1) && (
                <text x={cx} y={H - 3} textAnchor="middle" fontSize={9} fill="var(--muted)">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-center text-xs text-muted">{xTitle}</p>
      {hidden && <p className="mt-2 text-sm text-muted">{HIDDEN_NOTE}</p>}
      <table className="sr-only">
        <caption>
          {name} by {xTitle.toLowerCase()}
        </caption>
        <thead>
          <tr>
            <th scope="col">{xTitle}</th>
            <th scope="col">{name}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.label}>
              <th scope="row">{b.label}</th>
              <td>
                <Amount value={b.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
