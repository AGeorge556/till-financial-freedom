import { describe, expect, it } from "vitest";
import { toHoldingEvents } from "../backup";
import { type CashFlow, type Confirmation, type RateChange, cloudEstimate, validateCloudHistory } from "./clouds";
import { type GoldPrice, goldPricesFor, goldPurchaseEvent } from "./gold";
import { outstanding, validateLiabilityHistory } from "./liabilities";
import { egpToPiasters as egp } from "./money";
import { type HoldingEvent, type PriceUpdate, portfolioValue, replayHolding, validateHistory } from "./portfolio";
import { visibleRows } from "./voided";

// A record the way the database holds it: voidedAt set once it was corrected or removed.
type Voidable<T> = T & { voidedAt: string | null };
const VOID = "2026-04-01T09:00:00.000Z";
const live = <T>(row: T): Voidable<T> => ({ ...row, voidedAt: null });
const gone = <T>(row: T): Voidable<T> => ({ ...row, voidedAt: VOID });

let seq = 0;
const at = (date: string) => ({ date, createdAt: `2026-01-01T00:00:${String(seq++).padStart(2, "0")}Z` });
const buy = (date: string, quantity: string, price: string): HoldingEvent => ({ ...at(date), type: "purchase", quantity, price, fee: 0 });
const sell = (date: string, quantity: string, price: string): HoldingEvent => ({ ...at(date), type: "sale", quantity, price, fee: 0, tax: 0 });

describe("visibleRows", () => {
  const rows = [{ id: 1, voidedAt: null }, { id: 2, voidedAt: VOID }, { id: 3, voidedAt: new Date(VOID) }, { id: 4 } as { id: number; voidedAt?: null }];

  it("drops voided rows, whatever the type of the timestamp", () => {
    expect(visibleRows(rows).map((r) => r.id)).toEqual([1, 4]);
  });

  it("keeps them all when asked (backup, show removed)", () => {
    expect(visibleRows(rows, true)).toHaveLength(4);
  });
});

describe("a voided record counts as if it had never been entered", () => {
  it("price update: the holding is valued from the last live price", () => {
    const events = [buy("2026-01-01", "10", "100")];
    const prices = [live<PriceUpdate>({ ...at("2026-02-01"), price: "150" }), gone<PriceUpdate>({ ...at("2026-03-01"), price: "999" })];
    const withVoided = portfolioValue([{ id: "h", events, priceUpdates: visibleRows(prices) }], "2026-03-10");
    const neverEntered = portfolioValue([{ id: "h", events, priceUpdates: [prices[0]] }], "2026-03-10");
    expect(withVoided).toEqual(neverEntered);
    expect(withVoided.total).toBe(egp(1_500));
  });

  it("removing the only price falls back to the last transaction price", () => {
    const events = [buy("2026-01-01", "10", "100"), sell("2026-01-15", "2", "120")];
    const prices = [gone<PriceUpdate>({ ...at("2026-02-01"), price: "150" })];
    const line = portfolioValue([{ id: "h", events, priceUpdates: visibleRows(prices) }], "2026-03-10").lines[0];
    expect(line).toMatchObject({ source: "last-transaction", value: egp(960) });
  });

  it("gold price: the karat's price history skips it", () => {
    const prices = [
      live<GoldPrice>({ ...at("2026-02-01"), karat: 24, price: "4000" }),
      gone<GoldPrice>({ ...at("2026-03-01"), karat: 24, price: "9000" }),
    ];
    expect(goldPricesFor(visibleRows(prices), 21, "derive_24k")).toEqual(goldPricesFor([prices[0]], 21, "derive_24k"));
    const events = [goldPurchaseEvent(at("2026-01-01"), "10", "3000", 0)];
    const value = portfolioValue([{ id: "g", events, priceUpdates: goldPricesFor(visibleRows(prices), 21, "derive_24k") }], "2026-03-10");
    expect(value.total).toBe(egp(35_000));
  });

  it("cloud confirmation, rate change and deposit: the estimate ignores them", () => {
    const confirmations = [live<Confirmation>({ ...at("2026-01-01"), value: egp(1_000) }), gone<Confirmation>({ ...at("2026-02-01"), value: egp(5_000) })];
    const rates = [live<RateChange>({ ...at("2026-01-01"), apy: 0.2 }), gone<RateChange>({ ...at("2026-02-01"), apy: 0.9 })];
    const cashFlows = [
      live<CashFlow>({ ...at("2026-01-10"), kind: "deposit", amount: egp(100) }),
      gone<CashFlow>({ ...at("2026-02-10"), kind: "deposit", amount: egp(700) }),
    ];
    const asOf = "2026-06-01";
    expect(cloudEstimate({ confirmations: visibleRows(confirmations), rates: visibleRows(rates), cashFlows: visibleRows(cashFlows), asOf })).toEqual(
      cloudEstimate({ confirmations: [confirmations[0]], rates: [rates[0]], cashFlows: [cashFlows[0]], asOf }),
    );
  });

  it("loan update: the balance and the history check skip it", () => {
    const updates = [live({ date: "2026-02-01", delta: egp(500) }), gone({ date: "2026-02-15", delta: egp(9_000) })];
    const payments = [{ date: "2026-03-01", amount: egp(300) }];
    expect(outstanding(egp(1_000), visibleRows(updates), payments)).toBe(egp(1_200));
    expect(validateLiabilityHistory(egp(1_000), visibleRows(updates), payments)).toEqual({ ok: true });
  });

  it("corporate action: the holding replays without it", () => {
    const actions = [
      { holdingId: "h", kind: "BONUS" as const, ...at("2026-02-01"), quantity: "50", ratio: null, voidedAt: VOID },
      { holdingId: "h", kind: "SPLIT" as const, ...at("2026-03-01"), quantity: null, ratio: "2", voidedAt: null },
    ];
    const bought = [
      {
        type: "INVESTMENT_PURCHASE" as const,
        ...at("2026-01-01"),
        amount: egp(1_000),
        status: "posted" as const,
        fee: 0,
        grossAmount: null,
        taxWithheld: null,
        holdingId: "h",
        quantity: "10",
        unitPrice: "100",
      },
    ];
    expect(replayHolding(toHoldingEvents(bought, visibleRows(actions))).quantity).toBe("20");
    expect(replayHolding(toHoldingEvents(bought, visibleRows(actions, true))).quantity).toBe("120");
  });
});

describe("a history that is valid before a removal and invalid after it is refused", () => {
  it("a bonus issue that a later sale depends on", () => {
    const events = [buy("2026-01-01", "100", "10"), { ...at("2026-02-01"), type: "bonus" as const, quantity: "50" }, sell("2026-03-01", "120", "12")];
    expect(validateHistory(events)).toEqual({ ok: true });
    expect(validateHistory(events.filter((e) => e.type !== "bonus"))).toMatchObject({ ok: false, date: "2026-03-01" });
  });

  it("a deposit that a later withdrawal depends on", () => {
    const first = { ...at("2026-01-01"), kind: "deposit" as const, amount: egp(1_000) };
    const second = { ...at("2026-02-01"), kind: "deposit" as const, amount: egp(1_000) };
    const out = { ...at("2026-03-01"), kind: "withdrawal" as const, amount: egp(1_500) };
    const input = { confirmations: [], rates: [] };
    expect(validateCloudHistory({ ...input, cashFlows: [first, second, out] })).toEqual({ ok: true });
    expect(validateCloudHistory({ ...input, cashFlows: [first, out] })).toMatchObject({ ok: false, date: "2026-03-01" });
  });

  it("a confirmation that a later withdrawal depends on", () => {
    const confirmation = { ...at("2026-01-01"), value: egp(2_000) };
    const out = { ...at("2026-02-01"), kind: "withdrawal" as const, amount: egp(1_500) };
    expect(validateCloudHistory({ confirmations: [confirmation], rates: [], cashFlows: [out] })).toEqual({ ok: true });
    expect(validateCloudHistory({ confirmations: [], rates: [], cashFlows: [out] })).toMatchObject({ ok: false, date: "2026-02-01" });
  });

  it("a 'borrowed more' update that a later payment depends on", () => {
    const update = { date: "2026-02-01", delta: egp(500) };
    const payment = { date: "2026-03-01", amount: egp(1_200) };
    expect(validateLiabilityHistory(egp(1_000), [update], [payment])).toEqual({ ok: true });
    expect(validateLiabilityHistory(egp(1_000), [], [payment])).toMatchObject({ ok: false, date: "2026-03-01" });
  });
});
