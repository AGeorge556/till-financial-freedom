import { describe, expect, it } from "vitest";
import { egpToPiasters as egp } from "./money";
import {
  applyPurchase,
  applySale,
  averageCost,
  lineValue,
  marketValue,
  unrealizedPL,
  type Position,
} from "./holdings";

const empty: Position = { quantity: "0", costBasis: 0 };

describe("lineValue", () => {
  it("multiplies exactly and rounds once to piasters", () => {
    expect(lineValue("100", "100")).toBe(egp(10_000));
    expect(lineValue("2.5", "3000.50")).toBe(egp(7501.25));
    expect(lineValue("0.000001", "0.000001")).toBe(0);
    expect(lineValue("1.000001", "0.005")).toBe(1); // 0.5 piaster rounds half up
    // 0.1 x 0.2 style float error cannot occur
    expect(lineValue("0.1", "0.2")).toBe(2);
  });

  it("rejects malformed or over-precise decimals", () => {
    expect(() => lineValue("1.1234567", "1")).toThrow(RangeError);
    expect(() => lineValue("-1", "1")).toThrow(RangeError);
    expect(() => lineValue("abc", "1")).toThrow(RangeError);
  });
});

describe("fixture 4: buy 100 @ 100, sell 40 @ 150", () => {
  it("realizes +2,000 and leaves 60 shares at 100 average", () => {
    const bought = applyPurchase(empty, "100", "100", 0);
    const sale = applySale(bought, "40", "150", 0);
    expect(sale.costOfSharesSold).toBe(egp(4_000));
    expect(sale.netProceeds).toBe(egp(6_000));
    expect(sale.realizedPL).toBe(egp(2_000));
    expect(sale.remaining).toEqual({ quantity: "60", costBasis: egp(6_000) });
    expect(averageCost(sale.remaining)).toBe(egp(100));
  });
});

describe("fixture 5: buy 100 @ 100 then 50 @ 120", () => {
  it("gives 150 shares, 16,000 basis, 106.67 average", () => {
    const p = applyPurchase(applyPurchase(empty, "100", "100", 0), "50", "120", 0);
    expect(p).toEqual({ quantity: "150", costBasis: egp(16_000) });
    expect(averageCost(p)).toBe(10_667);
  });
});

describe("fees", () => {
  it("adds purchase fees to cost basis", () => {
    const p = applyPurchase(empty, "100", "100", egp(50));
    expect(p.costBasis).toBe(egp(10_050));
  });

  it("deducts sale fees from proceeds and realized P/L", () => {
    const p = applyPurchase(empty, "100", "100", egp(50));
    const sale = applySale(p, "40", "150", egp(30));
    expect(sale.costOfSharesSold).toBe(egp(4_020)); // 40% of 10,050
    expect(sale.netProceeds).toBe(egp(5_970));
    expect(sale.realizedPL).toBe(egp(1_950));
    expect(sale.remaining).toEqual({ quantity: "60", costBasis: egp(6_030) });
  });

  it("rejects negative or fractional fees", () => {
    expect(() => applyPurchase(empty, "1", "1", -1)).toThrow(RangeError);
    expect(() => applySale(applyPurchase(empty, "1", "1", 0), "1", "1", 0.5)).toThrow(RangeError);
  });
});

describe("fractional quantities (gold grams)", () => {
  it("handles 2.5 g and keeps basis exactly additive across a partial sale", () => {
    const p = applyPurchase(empty, "2.5", "3000", 0);
    expect(p).toEqual({ quantity: "2.5", costBasis: egp(7_500) });
    const sale = applySale(p, "1.25", "3200", 0);
    expect(sale.costOfSharesSold).toBe(egp(3_750));
    expect(sale.netProceeds).toBe(egp(4_000));
    expect(sale.remaining).toEqual({ quantity: "1.25", costBasis: egp(3_750) });
  });

  it("rounds a non-divisible cost slice to whole piasters, remainder stays in the position", () => {
    const p = applyPurchase(empty, "3", "10", 0); // 3,000 piasters over 3 units
    const sale = applySale(p, "1", "10", 0);
    expect(sale.costOfSharesSold).toBe(1_000);
    const odd = applySale({ quantity: "3", costBasis: 1_000 }, "1", "1", 0);
    expect(odd.costOfSharesSold).toBe(333);
    expect(odd.remaining.costBasis).toBe(667);
  });
});

describe("full sale and oversell", () => {
  it("leaves cost basis exactly 0 with no rounding residue", () => {
    let p = applyPurchase(empty, "3", "10.01", 7);
    p = applyPurchase(p, "0.333333", "9.99", 1);
    const first = applySale(p, "1.111111", "11", 0);
    const last = applySale(first.remaining, first.remaining.quantity, "11", 0);
    expect(last.remaining).toEqual({ quantity: "0", costBasis: 0 });
    expect(last.costOfSharesSold).toBe(first.remaining.costBasis);
    expect(first.costOfSharesSold + last.costOfSharesSold).toBe(p.costBasis);
  });

  it("throws when selling more than held or zero", () => {
    const p = applyPurchase(empty, "10", "5", 0);
    expect(() => applySale(p, "10.000001", "5", 0)).toThrow(/only 10 held/);
    expect(() => applySale(empty, "1", "5", 0)).toThrow(RangeError);
    expect(() => applySale(p, "0", "5", 0)).toThrow(RangeError);
  });
});

describe("valuation", () => {
  it("computes market value, unrealized P/L and empty-position average", () => {
    const p = applyPurchase(empty, "100", "100", 0);
    expect(marketValue(p, "110.5")).toBe(egp(11_050));
    expect(unrealizedPL(p, "110.5")).toBe(egp(1_050));
    expect(unrealizedPL(p, "90")).toBe(egp(-1_000));
    expect(averageCost(empty)).toBe(0);
  });
});
