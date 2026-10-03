import { describe, expect, it } from "vitest";
import { egpToPiasters, formatEGP, roundPiasters } from "./money";

describe("formatEGP", () => {
  it.each([
    [2500000, "25,000 EGP"],
    [0, "0 EGP"],
    [-0, "0 EGP"],
    [100, "1 EGP"],
    [123456789, "1,234,568 EGP"],
    [-200000, "−2,000 EGP"], // U+2212, not a hyphen
    [-40, "0 EGP"], // rounds to zero: no sign
  ])("whole EGP: %d -> %s", (amount, expected) => {
    expect(formatEGP(amount)).toBe(expected);
  });

  it.each([
    [250050, "2,500.50 EGP"],
    [5, "0.05 EGP"],
    [0, "0.00 EGP"],
    [-0, "0.00 EGP"],
    [-250050, "−2,500.50 EGP"],
    [-5, "−0.05 EGP"],
  ])("showPiasters: %d -> %s", (amount, expected) => {
    expect(formatEGP(amount, { showPiasters: true })).toBe(expected);
  });

  it("uses U+2212 for negatives", () => {
    expect(formatEGP(-200000).codePointAt(0)).toBe(0x2212);
  });
});

describe("roundPiasters", () => {
  it.each([
    [1.4, 1],
    [1.5, 2],
    [-1.4, -1],
    [100, 100],
  ])("%d -> %d", (value, expected) => {
    expect(roundPiasters(value)).toBe(expected);
  });

  it("normalises -0", () => {
    expect(Object.is(roundPiasters(-0.4), 0)).toBe(true);
    expect(Object.is(roundPiasters(-0), 0)).toBe(true);
  });

  it.each([Number.MAX_SAFE_INTEGER + 2, -(Number.MAX_SAFE_INTEGER + 2), NaN, Infinity])(
    "throws RangeError for %d",
    (value) => {
      expect(() => roundPiasters(value)).toThrow(RangeError);
    },
  );
});

describe("egpToPiasters", () => {
  it.each([
    [25000, 2500000],
    [0.29, 29], // 0.29 * 100 = 28.999999999999996
    [19.99, 1999],
    [-2000, -200000],
  ])("%d EGP -> %d piasters", (egp, expected) => {
    expect(egpToPiasters(egp)).toBe(expected);
  });
});
