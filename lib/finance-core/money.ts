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
