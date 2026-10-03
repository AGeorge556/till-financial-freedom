import { describe, expect, it } from "vitest";
import { lineValue } from "./holdings";
import {
  accountBalance,
  filterByDateRange,
  marketChange,
  netWorth,
  periodSummary,
  reconcile,
  type Tx,
} from "./ledger";
import { egpToPiasters as egp } from "./money";
import {
  dividendCash,
  holdingValue,
  lastTransactionPrice,
  portfolioValue,
  priceAsOf,
  purchaseCash,
  replayHolding,
  saleCash,
  staleness,
  validateHistory,
  type HoldingEvent,
  type PriceUpdate,
} from "./portfolio";

let seq = 0;
const at = (date: string, createdAt?: string) => ({ date, createdAt: createdAt ?? `2026-01-01T00:00:${String(seq++).padStart(2, "0")}Z` });
const buy = (date: string, quantity: string, price: string, feeEgp = 0, createdAt?: string): HoldingEvent => ({
  ...at(date, createdAt), type: "purchase", quantity, price, fee: egp(feeEgp),
});
const sell = (date: string, quantity: string, price: string, feeEgp = 0, taxEgp = 0, createdAt?: string): HoldingEvent => ({
  ...at(date, createdAt), type: "sale", quantity, price, fee: egp(feeEgp), tax: egp(taxEgp),
});
const dividend = (date: string, grossEgp: number, taxEgp: number): HoldingEvent => ({
  ...at(date), type: "dividend", gross: egp(grossEgp), tax: egp(taxEgp),
});
const bonus = (date: string, quantity: string): HoldingEvent => ({ ...at(date), type: "bonus", quantity });
const split = (date: string, ratio: string): HoldingEvent => ({ ...at(date), type: "split", ratio });
const writeOff = (date: string): HoldingEvent => ({ ...at(date), type: "writeOff" });
const price = (date: string, p: string, createdAt = "2026-01-01T00:00:00Z"): PriceUpdate => ({ date, price: p, createdAt });

describe("fixture 4: buy 100 @ 100, sell 40 @ 150", () => {
  const s = replayHolding([buy("2026-01-01", "100", "100"), sell("2026-02-01", "40", "150")]);

  it("realizes +2,000 and leaves 60 shares at 100 average", () => {
    expect(s.saleProceeds).toBe(egp(6_000));
    expect(s.realizedPL).toBe(egp(2_000));
    expect(s.saleProceeds - s.realizedPL).toBe(egp(4_000)); // cost of the 40 shares sold
    expect([s.quantity, s.costBasis, s.averageCost]).toEqual(["60", egp(6_000), egp(100)]);
    expect(s.invested).toBe(egp(10_000));
  });
});

describe("fixture 5: 100 @ 100 then 50 @ 120", () => {
  it("averages to 150 shares, basis 16,000, average 106.67", () => {
    const s = replayHolding([buy("2026-01-01", "100", "100"), buy("2026-01-02", "50", "120")]);
    expect([s.quantity, s.costBasis, s.averageCost, s.realizedPL]).toEqual(["150", egp(16_000), 10_667, 0]);
  });
});

describe("replayHolding", () => {
  it.each([
    {
      name: "purchase fee goes into basis and invested, not realized P/L",
      events: [buy("2026-01-01", "100", "100", 50)],
      expected: { quantity: "100", costBasis: egp(10_050), invested: egp(10_050), realizedPL: 0 },
    },
    {
      name: "sale fee and tax reduce proceeds and realized P/L",
      events: [buy("2026-01-01", "100", "100"), sell("2026-02-01", "40", "150", 30, 20)],
      expected: { quantity: "60", costBasis: egp(6_000), saleProceeds: egp(5_950), realizedPL: egp(1_950) },
    },
    {
      name: "sale cost uses the average incl. the buy fee",
      events: [buy("2026-01-01", "100", "100", 100), sell("2026-02-01", "50", "100")],
      expected: { costBasis: egp(5_050), saleProceeds: egp(5_000), realizedPL: -egp(50) },
    },
    {
      name: "selling everything clears the basis with no rounding residue",
      events: [buy("2026-01-01", "3", "10.01"), buy("2026-01-02", "4", "7.77"), sell("2026-02-01", "7", "9")],
      expected: { quantity: "0", costBasis: 0, averageCost: 0 },
    },
    {
      name: "bonus adds shares and leaves the basis, lowering the average",
      events: [buy("2026-01-01", "100", "100"), bonus("2026-02-01", "25")],
      expected: { quantity: "125", costBasis: egp(10_000), averageCost: egp(80) },
    },
    {
      name: "split multiplies shares and leaves the basis",
      events: [buy("2026-01-01", "100", "100"), split("2026-02-01", "2")],
      expected: { quantity: "200", costBasis: egp(10_000), averageCost: egp(50) },
    },
    {
      name: "reverse split divides shares and leaves the basis",
      events: [buy("2026-01-01", "100", "100"), split("2026-02-01", "0.1")],
      expected: { quantity: "10", costBasis: egp(10_000), averageCost: egp(1_000) },
    },
    {
      name: "write-off realizes the remaining basis as a loss",
      events: [buy("2026-01-01", "100", "100", 50), sell("2026-02-01", "50", "120"), writeOff("2026-03-01")],
      expected: { quantity: "0", costBasis: 0, averageCost: 0, realizedPL: egp(6_000) - egp(5_025) - egp(5_025) },
    },
    {
      name: "dividends are net of tax and never touch quantity or basis",
      events: [buy("2026-01-01", "100", "100"), dividend("2026-02-01", 500, 50), dividend("2026-03-01", 100, 0)],
      expected: { quantity: "100", costBasis: egp(10_000), dividendsNet: egp(550), realizedPL: 0 },
    },
  ])("$name", ({ events, expected }) => {
    expect(replayHolding(events)).toMatchObject(expected);
  });

  it("split rounds half up at the 6th decimal, once", () => {
    // 0.000005 x 0.5 = 0.0000025 -> 0.000003
    expect(replayHolding([bonus("2026-01-01", "0.000005"), split("2026-01-02", "0.5")]).quantity).toBe("0.000003");
    // 0.000004 x 0.5 = 0.000002 exactly
    expect(replayHolding([bonus("2026-01-01", "0.000004"), split("2026-01-02", "0.5")]).quantity).toBe("0.000002");
    expect(replayHolding([buy("2026-01-01", "1", "1"), split("2026-01-02", "0.333333")]).quantity).toBe("0.333333");
  });

  it("a back-dated purchase changes a later sale's realized P/L", () => {
    const base = [buy("2026-01-01", "100", "100"), sell("2026-03-01", "50", "150")];
    expect(replayHolding(base).realizedPL).toBe(egp(2_500));
    const backdated = [...base, buy("2026-02-01", "100", "200")]; // entered later, dated before the sale
    const s = replayHolding(backdated);
    expect(s.realizedPL).toBe(0); // average is now 150
    expect([s.quantity, s.costBasis]).toEqual(["150", egp(22_500)]);
  });

  it("orders same-date events by createdAt, not by array order", () => {
    const a = buy("2026-01-01", "100", "100", 0, "2026-01-01T09:00:00Z");
    const b = sell("2026-01-01", "40", "150", 0, 0, "2026-01-01T10:00:00Z");
    expect(replayHolding([b, a]).quantity).toBe("60");
    const c = buy("2026-01-01", "100", "200", 0, "2026-01-01T11:00:00Z");
    // sale at 10:00 sees only the first purchase, so its cost is 100 per share
    expect(replayHolding([c, b, a]).realizedPL).toBe(egp(2_000));
  });

  it("asOf ignores later events", () => {
    const events = [buy("2026-01-01", "100", "100"), sell("2026-02-01", "40", "150"), writeOff("2026-03-01")];
    expect(replayHolding(events, "2026-01-31")).toMatchObject({ quantity: "100", realizedPL: 0 });
    expect(replayHolding(events, "2026-02-01")).toMatchObject({ quantity: "60", realizedPL: egp(2_000) });
    expect(replayHolding(events, "2026-03-01").quantity).toBe("0");
    expect(replayHolding(events, "2025-12-31").quantity).toBe("0");
  });
});

describe("validateHistory", () => {
  const ok = { ok: true };

  it.each([
    ["a valid history", [buy("2026-01-01", "100", "100"), sell("2026-02-01", "100", "150")], ok],
    ["an empty history", [], ok],
    [
      "selling more than held",
      [buy("2026-01-01", "100", "100"), sell("2026-02-01", "101", "150")],
      { ok: false, date: "2026-02-01" },
    ],
    ["selling before any purchase", [sell("2026-01-01", "1", "1")], { ok: false, date: "2026-01-01" }],
    [
      "removing the purchase a later sale depends on (void)",
      [sell("2026-02-01", "40", "150")],
      { ok: false, date: "2026-02-01" },
    ],
    [
      "a back-dated sale before the purchase",
      [buy("2026-02-01", "100", "100"), sell("2026-01-15", "10", "100")],
      { ok: false, date: "2026-01-15" },
    ],
    [
      "a write-off followed by a sale",
      [buy("2026-01-01", "100", "100"), writeOff("2026-02-01"), sell("2026-03-01", "1", "1")],
      { ok: false, date: "2026-03-01" },
    ],
    [
      "a reverse split that leaves too few shares for a later sale",
      [buy("2026-01-01", "100", "100"), split("2026-02-01", "0.1"), sell("2026-03-01", "50", "1")],
      { ok: false, date: "2026-03-01" },
    ],
    [
      "a bonus that makes a sale possible",
      [buy("2026-01-01", "100", "100"), bonus("2026-02-01", "20"), sell("2026-03-01", "120", "1")],
      ok,
    ],
    ["a zero split ratio", [buy("2026-01-01", "1", "1"), split("2026-02-01", "0")], { ok: false, date: "2026-02-01" }],
  ] as [string, HoldingEvent[], object][])("%s", (_name, events, expected) => {
    expect(validateHistory(events)).toMatchObject(expected);
  });

  it("an edit of an earlier purchase is refused when a later sale no longer fits", () => {
    const original = [buy("2026-01-01", "100", "100"), sell("2026-02-01", "80", "150")];
    expect(validateHistory(original).ok).toBe(true);
    const edited = [buy("2026-01-01", "50", "100"), original[1]];
    expect(validateHistory(edited)).toMatchObject({ ok: false, date: "2026-02-01" });
  });

  it("same-date events follow createdAt: sale logged before its purchase is refused", () => {
    const early = buy("2026-01-01", "100", "100", 0, "2026-01-01T09:00:00Z");
    const late = sell("2026-01-01", "10", "100", 0, 0, "2026-01-01T10:00:00Z");
    expect(validateHistory([early, late]).ok).toBe(true);
    const swapped = [{ ...early, createdAt: "2026-01-01T11:00:00Z" }, late];
    expect(validateHistory(swapped)).toMatchObject({ ok: false, date: "2026-01-01" });
  });
});

describe("cash helpers", () => {
  it("purchaseCash = quantity x price + fee; saleCash = gross - fee - tax; dividendCash = gross - tax", () => {
    expect(purchaseCash("50", "120", egp(30))).toBe(egp(6_030));
    expect(saleCash("30", "130", egp(20), egp(10))).toBe(egp(3_870));
    expect(lineValue("30", "130")).toBe(egp(3_900));
    expect(dividendCash(egp(500), egp(50))).toBe(egp(450));
  });

  it.each([
    ["zero quantity", () => purchaseCash("0", "10", 0)],
    ["a fractional-piaster fee", () => purchaseCash("1", "10", 0.5)],
    ["a zero-cash purchase", () => purchaseCash("1", "0", 0)],
    ["fees swallowing the proceeds", () => saleCash("1", "10", egp(10), 0)],
    ["a negative tax", () => saleCash("1", "10", 0, -1)],
    ["tax equal to the dividend", () => dividendCash(egp(5), egp(5))],
  ])("refuses %s", (_name, fn) => {
    expect(fn).toThrow(RangeError);
  });
});

describe("priceAsOf / holdingValue", () => {
  const prices = [price("2026-03-10", "120"), price("2026-03-01", "100"), price("2026-03-20", "140")];
  const position = { quantity: "100", costBasis: egp(10_000) };

  it.each([
    ["2026-02-28", null],
    ["2026-03-01", "100"],
    ["2026-03-09", "100"], // step function: no interpolation toward 120
    ["2026-03-10", "120"],
    ["2026-03-19", "120"],
    ["2026-04-30", "140"],
  ])("price as of %s is %s", (date, expected) => {
    expect(priceAsOf(prices, date)?.price ?? null).toBe(expected);
  });

  it("on the same date the later-created update wins", () => {
    const p = [price("2026-03-01", "100", "2026-03-01T09:00:00Z"), price("2026-03-01", "105", "2026-03-01T10:00:00Z")];
    expect(priceAsOf(p, "2026-03-01")?.price).toBe("105");
    expect(priceAsOf([...p].reverse(), "2026-03-01")?.price).toBe("105");
  });

  it("values with the latest price on or before the date", () => {
    expect(holdingValue(position, prices, "90", "2026-03-15")).toEqual({
      value: egp(12_000),
      priceDate: "2026-03-10",
      source: "price",
    });
  });

  it("falls back to the last transaction price, flagged, when no update is dated yet", () => {
    expect(holdingValue(position, prices, "90", "2026-02-15")).toEqual({
      value: egp(9_000),
      priceDate: null,
      source: "last-transaction",
    });
    expect(holdingValue(position, [], "90", "2026-02-15").source).toBe("last-transaction");
  });

  it("has no value when there is neither", () => {
    expect(holdingValue(position, [], null, "2026-02-15")).toEqual({ value: 0, priceDate: null, source: "none" });
  });

  it("lastTransactionPrice is the latest buy or sale on or before the date", () => {
    const events = [buy("2026-01-01", "10", "100"), sell("2026-02-01", "5", "130"), dividend("2026-03-01", 10, 0)];
    expect(lastTransactionPrice(events, "2025-12-31")).toBeNull();
    expect(lastTransactionPrice(events, "2026-01-15")).toBe("100");
    expect(lastTransactionPrice(events, "2026-04-01")).toBe("130");
  });
});

describe("staleness", () => {
  it.each([
    ["2026-03-10", "2026-03-10", 7, 0, false],
    ["2026-03-03", "2026-03-10", 7, 7, false], // exactly N days old is fresh
    ["2026-03-02", "2026-03-10", 7, 8, true], // N + 1 is stale
    ["2026-02-28", "2026-03-01", 1, 1, false], // across a month end (2026 is not a leap year)
    ["2026-02-27", "2026-03-01", 1, 2, true],
    ["2026-03-11", "2026-03-10", 7, 0, false], // a future-dated price is never negative days
  ])("price %s on %s with N=%i -> %i days, stale %s", (priceDate, today, n, days, stale) => {
    expect(staleness(priceDate, today, n)).toEqual({ days, stale });
  });

  it("no price date at all is stale", () => {
    expect(staleness(null, "2026-03-10", 7)).toEqual({ days: null, stale: true });
  });
});

describe("portfolioValue", () => {
  const fresh = { id: "fresh", events: [buy("2026-03-01", "10", "100")], priceUpdates: [price("2026-03-09", "110")] };
  const old = { id: "old", events: [buy("2026-01-01", "10", "50")], priceUpdates: [price("2026-01-02", "60")] };
  const sold = { id: "sold", events: [buy("2026-01-01", "5", "50"), sell("2026-01-05", "5", "60")], priceUpdates: [] };

  it("totals values and flags stale ones", () => {
    const r = portfolioValue([fresh, old], "2026-03-10", 7);
    expect(r.lines.map((l) => [l.id, l.value, l.stale])).toEqual([
      ["fresh", egp(1_100), false],
      ["old", egp(600), true],
    ]);
    expect(r.total).toBe(egp(1_700));
    expect(r.stale).toBe(true);
    expect(portfolioValue([fresh], "2026-03-10", 7).stale).toBe(false);
    expect(portfolioValue([old], "2026-03-10", 365).stale).toBe(false);
  });

  it("a fully sold holding is worth 0 and never stale; with no price update a held one is stale", () => {
    expect(portfolioValue([sold], "2026-03-10")).toMatchObject({ total: 0, stale: false });
    const noPrice = { id: "np", events: [buy("2026-03-10", "2", "30")], priceUpdates: [] };
    const r = portfolioValue([noPrice], "2026-03-10");
    expect(r.lines[0]).toMatchObject({ value: egp(60), source: "last-transaction", stale: true, days: null });
  });

  it("values as of a past date from that date's quantity and price only", () => {
    const h = {
      id: "h",
      events: [buy("2026-01-01", "10", "100"), buy("2026-02-01", "10", "100")],
      priceUpdates: [price("2026-01-10", "100"), price("2026-02-10", "150")],
    };
    expect(portfolioValue([h], "2026-01-31").total).toBe(egp(1_000));
    expect(portfolioValue([h], "2026-02-09").total).toBe(egp(2_000));
    expect(portfolioValue([h], "2026-02-10").total).toBe(egp(3_000));
  });
});

describe("reconciliation identity (rule J) with real positions and ledger", () => {
  const holding = [
    buy("2026-02-10", "100", "100"),
    buy("2026-03-10", "50", "120", 30),
    sell("2026-03-15", "30", "130", 20, 10),
  ];
  const prices = [price("2026-02-28", "100"), price("2026-03-31", "125")];
  const h = { id: "thndr-stock", events: [...holding, dividend("2026-03-20", 500, 50)], priceUpdates: prices };
  const opening = egp(50_000); // bank balance before March, after the February purchase

  const tx = (t: Partial<Tx> & Pick<Tx, "type" | "amount" | "date">): Tx => ({ status: "posted", ...t });
  const march: Tx[] = [
    tx({ type: "INCOME", amount: egp(20_000), toAccountId: "bank", date: "2026-03-01" }),
    tx({ type: "EXPENSE", amount: egp(8_000), fromAccountId: "bank", date: "2026-03-05" }),
    tx({ type: "INVESTMENT_PURCHASE", amount: purchaseCash("50", "120", egp(30)), fromAccountId: "bank", date: "2026-03-10" }),
    tx({ type: "INVESTMENT_SALE", amount: saleCash("30", "130", egp(20), egp(10)), toAccountId: "bank", date: "2026-03-15" }),
    tx({ type: "DIVIDEND", amount: dividendCash(egp(500), egp(50)), toAccountId: "bank", date: "2026-03-20" }),
  ];

  it("net worth change = savings + market change + adjustments", () => {
    const startHoldings = portfolioValue([h], "2026-02-28").total;
    const endHoldings = portfolioValue([h], "2026-03-31").total;
    const summary = periodSummary(filterByDateRange(march, "2026-03-01", "2026-03-31"));

    expect(startHoldings).toBe(egp(10_000));
    expect(endHoldings).toBe(egp(15_000)); // 120 shares at 125
    expect(summary.netInvested).toBe(egp(6_030) - egp(3_870));
    expect(summary.savings).toBe(egp(20_000) + egp(450) - egp(8_000));

    const market = marketChange(startHoldings, endHoldings, summary.netInvested);
    expect(market).toBe(egp(2_840));
    const startNW = netWorth({ cash: opening, holdings: startHoldings, liabilities: 0 });
    const endNW = netWorth({ cash: accountBalance(opening, "bank", march), holdings: endHoldings, liabilities: 0 });
    expect(endNW - startNW).toBe(egp(15_290));
    expect(reconcile(endNW - startNW, summary.savings, market, summary.adjustments)).toEqual({ ok: true, difference: 0 });
  });

  it("the replayed totals agree with the ledger's invested and sale proceeds for the month", () => {
    const end = replayHolding(h.events, "2026-03-31");
    const start = replayHolding(h.events, "2026-02-28");
    const summary = periodSummary(march);
    expect(end.invested - start.invested).toBe(summary.invested);
    expect(end.saleProceeds - start.saleProceeds).toBe(summary.saleProceeds);
    expect(end.dividendsNet - start.dividendsNet).toBe(summary.investmentIncome);
  });

  it("a stale or wrong holdings value breaks the identity", () => {
    const summary = periodSummary(march);
    const endNW = netWorth({ cash: accountBalance(opening, "bank", march), holdings: egp(15_000), liabilities: 0 });
    const startNW = netWorth({ cash: opening, holdings: egp(10_000), liabilities: 0 });
    const wrongMarket = marketChange(egp(10_000), egp(15_000), summary.invested); // ignores sale proceeds
    expect(reconcile(endNW - startNW, summary.savings, wrongMarket, 0).ok).toBe(false);
  });
});
