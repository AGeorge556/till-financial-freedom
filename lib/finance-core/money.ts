/** Every EGP amount is an integer number of piasters (1 EGP = 100 piasters). Never a float. */
export type Piasters = number;

/** The engine boundary: floats from projections become whole piasters here. */
export function roundPiasters(value: number): Piasters {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError(`Amount out of range: ${value}`);
  }
  return rounded === 0 ? 0 : rounded; // normalise -0
}

export function egpToPiasters(egp: number): Piasters {
  return roundPiasters(egp * 100);
}

const wholeEgp = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const exactEgp = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "25,000 EGP", "−2,000 EGP". Whole EGP by default; piasters only in transaction detail. */
export function formatEGP(amount: Piasters, options: { showPiasters?: boolean } = {}): string {
  const egp = Math.abs(amount) / 100;
  const digits = options.showPiasters ? exactEgp.format(egp) : wholeEgp.format(egp);
  const isZero = options.showPiasters ? amount === 0 : Math.round(egp) === 0;
  return `${amount < 0 && !isZero ? "−" : ""}${digits} EGP`;
}

// Thousands commas must be well-formed ("1,250" yes, "1,25" no); 1-2 decimals.
const EGP_INPUT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Parses what a person types ("1,250.5") into piasters. Digit-string math, no float multiplication. */
export function parseEGP(text: string): Piasters | null {
  const m = EGP_INPUT.exec(text.trim());
  if (!m) return null;
  const piasters = Number(m[1].replaceAll(",", "") + (m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(piasters) ? piasters : null;
}
