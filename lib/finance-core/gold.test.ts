import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_DAYS_GOLD,
  type GoldPrice,
  goldPriceAsOf,
  goldPricesFor,
  goldPurchaseEvent,
  goldValue,
  type Karat,
  karatPrice,
} from "./gold";
import { egpToPiasters as egp } from "./money";
import { portfolioValue, purchaseCash, replayHolding, type HoldingEvent } from "./portfolio";

const stamp = (date: string, n = 0) => ({ date, createdAt: `2026-01-01T00:00:0${n}Z` });
const p = (date: string, karat: Karat, price: string, n = 0): GoldPrice => ({ ...stamp(date, n), karat, price });
const sell = (date: string, quantity: string, price: string): HoldingEvent => ({
  ...stamp(date, 9), type: "sale", quantity, price, fee: 0, tax: 0,
});

describe("karatPrice", () => {
  it.each([
    ["24K is itself", "4000", 24, "4000"],
    ["21K is 21/24 of 24K", "4000", 21, "3500"],
    ["18K is 18/24 of 24K", "4000", 18, "3000"],
    ["21K keeps the 6th decimal", "3333.333333", 21, "2916.666666"], // exact 2916.666666375
    ["18K carries up across the decimal point", "3333.333333", 18, "2500"], // exact 2499.99999975
    ["21K, exact 3510.80246825 rounds down", "4012.345678", 21, "3510.802468"],
    ["half up: 18K of 0.000002 is 1.5 micro-units", "0.000002", 18, "0.000002"],
    ["half up: 18K of 0.000006 is 4.5 micro-units", "0.000006", 18, "0.000005"],
  ] as [string, string, Karat, string][])("%s", (_name, price24, karat, expected) => {
    expect(karatPrice(price24, karat)).toBe(expected);
  });

  it("derives to the piaster: 10 g of 21K and 18K from a 24K price of 4,012.34", () => {
    expect(goldValue("10", karatPrice("4012.34", 21))).toBe(egp(35_107.98)); // 21K price 3510.7975 exact; 10 g = 35,107.975, rounded half up once
    expect(goldValue("10", karatPrice("4012.34", 18))).toBe(egp(30_092.55)); // 10 x 3009.255
  });

  it.each([
    ["an unsupported karat", () => karatPrice("4000", 22 as Karat)],
    ["a negative price", () => karatPrice("-1", 21)],
    ["a price with 7 decimals", () => karatPrice("1.1234567", 21)],
  ])("refuses %s", (_name, fn) => {
    expect(fn).toThrow(RangeError);
  });
});

describe("goldPriceAsOf", () => {
  const prices = [p("2026-03-01", 24, "4000"), p("2026-03-10", 24, "4100"), p("2026-03-05", 21, "3600")];

  it.each([
    ["derive: nothing before the first 24K price", 21, "2026-02-28", "derive_24k", null],
    ["derive: 21K from the 24K price, ignoring a 21K row", 21, "2026-03-05", "derive_24k", "3500"],
    ["derive: step function, no interpolation", 21, "2026-03-09", "derive_24k", "3500"],
    ["derive: a newer 24K price takes over", 21, "2026-03-10", "derive_24k", "3587.5"],
    ["derive: 24K is the price itself", 24, "2026-03-10", "derive_24k", "4100"],
    ["per_karat: no 21K price yet", 21, "2026-03-04", "per_karat", null],
    ["per_karat: the karat's own price", 21, "2026-03-05", "per_karat", "3600"],
    ["per_karat: 18K has none even though 24K does", 18, "2026-03-10", "per_karat", null],
    ["per_karat: 24K uses 24K rows", 24, "2026-03-09", "per_karat", "4000"],
  ] as [string, Karat, string, "derive_24k" | "per_karat", string | null][])("%s", (_name, karat, date, mode, expected) => {
    expect(goldPriceAsOf(prices, karat, date, mode)?.price ?? null).toBe(expected);
  });

  it("on the same date the later-created price wins", () => {
    const same = [p("2026-03-01", 24, "4000", 1), p("2026-03-01", 24, "4050", 2)];
    expect(goldPriceAsOf(same, 24, "2026-03-01", "derive_24k")?.price).toBe("4050");
    expect(goldPriceAsOf([...same].reverse(), 24, "2026-03-01", "derive_24k")?.price).toBe("4050");
  });

  it("reports the date of the price used", () => {
    expect(goldPriceAsOf(prices, 21, "2026-03-09", "derive_24k")?.date).toBe("2026-03-01");
  });
});

describe("a gold holding through the portfolio engine", () => {
  // 10 g of 21K bought at a metal price of 3,500 per gram with 500 workmanship.
  const buy = goldPurchaseEvent(stamp("2026-03-01"), "10", "3500", egp(500));
  const holding = (prices: GoldPrice[], extra: HoldingEvent[] = []) => ({
    id: "g",
    events: [buy, ...extra],
    priceUpdates: goldPricesFor(prices, 21, "derive_24k"),
    staleDays: DEFAULT_STALE_DAYS_GOLD,
  });

  it("maps a purchase onto the unit purchase event: workmanship is in cost basis", () => {
    expect(replayHolding([buy])).toMatchObject({ quantity: "10", costBasis: egp(35_500), invested: egp(35_500) });
    expect(purchaseCash("10", "3500", egp(500))).toBe(egp(35_500));
  });

  it("shows a loss equal to the workmanship on day one at an unchanged price", () => {
    const line = portfolioValue([holding([p("2026-03-01", 24, "4000")])], "2026-03-01").lines[0];
    expect(line.value).toBe(egp(35_000)); // 10 x (4000 x 21/24)
    expect(line.value - line.costBasis).toBe(-egp(500));
  });

  it("values with the buy-back price, not what was paid", () => {
    // paid 3,500 per gram; the dealer now buys 24K back at 3,800, which is 3,325 for 21K
    const line = portfolioValue([holding([p("2026-03-02", 24, "3800")])], "2026-03-02").lines[0];
    expect(line.value).toBe(egp(33_250));
    expect(line.value).not.toBe(goldValue("10", "3500"));
  });

  it("follows later prices and never uses one dated after the valuation date", () => {
    const prices = [p("2026-03-02", 24, "4000"), p("2026-03-20", 24, "4400")];
    expect(portfolioValue([holding(prices)], "2026-03-19").total).toBe(egp(35_000));
    expect(portfolioValue([holding(prices)], "2026-03-20").total).toBe(egp(38_500));
  });

  it("with no price yet it is valued at the last transaction's metal price and marked as such", () => {
    const line = portfolioValue([holding([])], "2026-03-02").lines[0];
    expect(line).toMatchObject({ value: egp(35_000), source: "last-transaction", priceDate: null, stale: true });
    const sold = portfolioValue([holding([], [sell("2026-03-02", "2", "3600")])], "2026-03-03").lines[0];
    expect(sold).toMatchObject({ quantity: "8", value: egp(28_800), source: "last-transaction" }); // 8 x last sale price
  });

  it("a partial sale takes its share of the average cost, workmanship included", () => {
    const s = replayHolding([buy, sell("2026-03-10", "4", "3600")]);
    // cost of 4 g = 35,500 x 4/10 = 14,200; proceeds 14,400
    expect([s.realizedPL, s.quantity, s.costBasis]).toEqual([egp(200), "6", egp(21_300)]);
  });

  it("is stale after stale_days_gold, not after the stock default", () => {
    const prices = [p("2026-03-01", 24, "4000")];
    expect(portfolioValue([holding(prices)], "2026-03-15").stale).toBe(false); // 14 days old
    expect(portfolioValue([holding(prices)], "2026-03-16").stale).toBe(true); // 15 days old
    const withoutOverride = { ...holding(prices), staleDays: undefined };
    expect(portfolioValue([withoutOverride], "2026-03-10").stale).toBe(true); // 9 days old, default 7
    expect(portfolioValue([holding(prices)], "2026-03-10").stale).toBe(false); // same age, gold's 14
  });
});
