import { describe, expect, it } from "vitest";
import {
  type CashFlow,
  type Confirmation,
  type RateChange,
  apyAsOf,
  cloudEstimate,
  cloudLine,
  cloudProjection,
  cloudStaleness,
  growthFactor,
  validateCloudHistory,
  validateWithdrawal,
} from "./clouds";
import { type Tx, filterByDateRange, marketChange, periodSummary } from "./ledger";
import { egpToPiasters as egp } from "./money";

let seq = 0;
const stamp = (date: string) => ({ date, createdAt: `2026-01-01T00:00:${String(seq++).padStart(2, "0")}Z` });
const rate = (date: string, apy: number): RateChange => ({ ...stamp(date), apy });
const confirm = (date: string, valueEgp: number): Confirmation => ({ ...stamp(date), value: egp(valueEgp) });
const deposit = (date: string, amountEgp: number): CashFlow => ({ ...stamp(date), kind: "deposit", amount: egp(amountEgp) });
const withdraw = (date: string, amountEgp: number): CashFlow => ({ ...stamp(date), kind: "withdrawal", amount: egp(amountEgp) });

const est = (input: { asOf: string; confirmations?: Confirmation[]; cashFlows?: CashFlow[]; rates?: RateChange[] }) =>
  cloudEstimate({ confirmations: [], cashFlows: [], rates: [], ...input });

const at20 = [rate("2026-01-01", 0.2)];

describe("growthFactor", () => {
  it.each([
    ["no rates: no growth", [], "2026-01-01", "2027-01-01", 1],
    ["exactly 365 days at 20% is x1.2", at20, "2026-01-01", "2027-01-01", 1.2],
    ["730 days compounds: 1.2^2", at20, "2026-01-01", "2028-01-01", 1.44],
    ["same day", at20, "2026-06-01", "2026-06-01", 1],
    ["to before from", at20, "2026-06-01", "2026-01-01", 1],
    ["a rate that starts later: no growth before it", [rate("2026-04-11", 0.2)], "2026-01-01", "2026-04-11", 1],
    ["negative APY shrinks", [rate("2026-01-01", -0.1)], "2026-01-01", "2027-01-01", 0.9],
    ["a rate dated after the end is ignored", [rate("2026-01-01", 0.2), rate("2026-09-01", 0.5)], "2026-01-01", "2026-08-01", 1.2 ** (212 / 365)],
  ] as [string, RateChange[], string, string, number][])("%s", (_name, rates, from, to, expected) => {
    expect(growthFactor(rates, from, to)).toBeCloseTo(expected, 12);
  });

  it("compounds each stretch at the rate then in force", () => {
    const rates = [rate("2026-01-01", 0.2), rate("2026-04-11", 0.1)]; // 100 days at 20%, then 265 at 10%
    expect(growthFactor(rates, "2026-01-01", "2027-01-01")).toBeCloseTo(1.2 ** (100 / 365) * 1.1 ** (265 / 365), 12);
  });

  it("starting after a change uses the rate already in force, not the first one", () => {
    const rates = [rate("2026-01-01", 0.2), rate("2026-04-11", 0.1)];
    expect(growthFactor(rates, "2026-06-01", "2027-06-01")).toBeCloseTo(1.1, 12);
  });

  it("two changes on one date: the later-created one wins", () => {
    const rates = [rate("2026-01-01", 0.2), { ...rate("2026-01-01", 0.3), createdAt: "2099-01-01T00:00:00Z" }];
    expect(growthFactor(rates, "2026-01-01", "2027-01-01")).toBeCloseTo(1.3, 12);
    expect(apyAsOf(rates, "2026-01-01")).toBe(0.3);
    expect(apyAsOf(rates, "2025-12-31")).toBeNull();
  });

  it("refuses an APY of -100% or worse", () => {
    expect(() => growthFactor([rate("2026-01-01", -1)], "2026-01-01", "2027-01-01")).toThrow(RangeError);
  });
});

describe("cloudEstimate", () => {
  it("100,000 at 20% APY for exactly 365 days is 120,000", () => {
    const r = est({ cashFlows: [deposit("2026-01-01", 100_000)], rates: at20, asOf: "2027-01-01" });
    expect(r).toEqual({ value: egp(120_000), basis: egp(100_000), growth: egp(20_000), label: "estimated", anchorDate: null });
  });

  it.each([
    // exact values from (1.2)^(days/365) x 100,000, rounded once to the piaster
    ["182 days (2026-01-01 to 2026-07-02)", "2026-07-02", 10_951_716], // 109,517.16
    ["6 calendar months, 181 days", "2026-07-01", 10_946_246], // 109,462.46; a half year of 182.5 days would be 109,544.51
    ["one day", "2026-01-02", 10_004_996], // 100,049.96
  ])("%s", (_name, asOf, piasters) => {
    expect(est({ cashFlows: [deposit("2026-01-01", 100_000)], rates: at20, asOf }).value).toBe(piasters);
  });

  it("APY is an effective annual rate, not 20%/12 compounded monthly", () => {
    const monthly = 100_000 * (1 + 0.2 / 12) ** 12; // 121,939: what treating APY as 20%/12 would give
    expect(est({ cashFlows: [deposit("2026-01-01", 100_000)], rates: at20, asOf: "2027-01-01" }).value).toBeLessThan(egp(monthly));
  });

  it("a rate change mid-period: 100 days at 20% then 265 at 10%", () => {
    const rates = [rate("2026-01-01", 0.2), rate("2026-04-11", 0.1)];
    expect(est({ cashFlows: [deposit("2026-01-01", 100_000)], rates, asOf: "2027-01-01" }).value).toBe(11_265_377); // 112,653.77
  });

  it("a rate that starts after the deposit leaves the earlier days ungrown", () => {
    const r = est({ cashFlows: [deposit("2026-01-01", 100_000)], rates: [rate("2026-04-11", 0.2)], asOf: "2027-01-01" });
    expect(r.value).toBe(11_415_311); // 100,000 x 1.2^(265/365) = 114,153.11
  });

  it("deposits after an anchor grow from their own date", () => {
    const r = est({
      confirmations: [confirm("2026-01-01", 100_000)],
      cashFlows: [deposit("2026-04-11", 50_000)],
      rates: at20,
      asOf: "2027-01-01",
    });
    expect(r.value).toBe(17_707_656); // 120,000 + 50,000 x 1.2^(265/365) = 177,076.56
    expect(r).toMatchObject({ label: "estimated", anchorDate: "2026-01-01" });
  });

  it("withdrawals after an anchor come out of the grown balance", () => {
    const r = est({
      confirmations: [confirm("2026-01-01", 100_000)],
      cashFlows: [withdraw("2026-04-11", 30_000)],
      rates: at20,
      asOf: "2027-01-01",
    });
    expect(r.value).toBe(8_575_407); // 120,000 - 30,000 x 1.2^(265/365) = 85,754.07
  });

  it("flows dated before the anchor are in the basis but not grown again", () => {
    const r = est({
      confirmations: [confirm("2026-01-01", 150_000)],
      cashFlows: [deposit("2025-12-01", 100_000)],
      rates: at20,
      asOf: "2026-01-01",
    });
    expect(r).toEqual({ value: egp(150_000), basis: egp(100_000), growth: egp(50_000), label: "confirmed", anchorDate: "2026-01-01" });
  });

  it("a confirmation re-anchors: later estimates start from it, earlier dates keep the old anchor", () => {
    const cashFlows = [deposit("2026-01-01", 100_000)];
    const before = est({ cashFlows, rates: at20, asOf: "2027-01-01" });
    const confirmations = [confirm("2026-07-01", 112_000)]; // the product shows more than the estimate (109,462)
    const after = est({ cashFlows, confirmations, rates: at20, asOf: "2027-01-01" });
    expect(before.value).toBe(egp(120_000));
    expect(after.value).toBe(12_278_181); // 112,000 x 1.2^(184/365) = 122,781.81; the January deposit is not grown again
    expect(after.anchorDate).toBe("2026-07-01");
    // as of a date before the confirmation, the confirmation does not exist yet
    expect(est({ cashFlows, confirmations, rates: at20, asOf: "2026-06-30" })).toMatchObject({ anchorDate: null, label: "estimated" });
  });

  it("the latest confirmation on or before asOf is the anchor", () => {
    const confirmations = [confirm("2026-03-01", 101_000), confirm("2026-06-01", 105_000), confirm("2026-09-01", 99_000)];
    expect(est({ confirmations, asOf: "2026-07-15" })).toMatchObject({ anchorDate: "2026-06-01" });
    expect(est({ confirmations, asOf: "2026-09-01" })).toMatchObject({ anchorDate: "2026-09-01", value: egp(99_000), label: "confirmed" });
  });

  describe("label", () => {
    const confirmations = [{ date: "2026-03-01", createdAt: "2026-03-01T10:00:00Z", value: egp(100_000) }];

    it.each([
      ["on the anchor date with nothing after it", [], "2026-03-01", "confirmed"],
      ["the next day, with no growth recorded", [], "2026-03-02", "estimated"],
      ["a same-day deposit entered before the confirmation is already in its value", [{ date: "2026-03-01", createdAt: "2026-03-01T09:00:00Z", kind: "deposit", amount: egp(5_000) }], "2026-03-01", "confirmed"],
      ["a same-day deposit entered after the confirmation", [{ date: "2026-03-01", createdAt: "2026-03-01T11:00:00Z", kind: "deposit", amount: egp(5_000) }], "2026-03-01", "estimated"],
    ] as [string, CashFlow[], string, string][])("%s", (_name, cashFlows, asOf, label) => {
      expect(est({ confirmations, cashFlows, asOf }).label).toBe(label);
    });

    it("the early same-day deposit is not counted twice, the late one is added once", () => {
      const early: CashFlow = { date: "2026-03-01", createdAt: "2026-03-01T09:00:00Z", kind: "deposit", amount: egp(5_000) };
      const late: CashFlow = { ...early, createdAt: "2026-03-01T11:00:00Z" };
      expect(est({ confirmations, cashFlows: [early], asOf: "2026-03-01" }).value).toBe(egp(100_000));
      expect(est({ confirmations, cashFlows: [late], asOf: "2026-03-01" }).value).toBe(egp(105_000));
    });

    it("never confirmed is estimated", () => {
      expect(est({ cashFlows: [deposit("2026-03-01", 1_000)], asOf: "2026-03-01" }).label).toBe("estimated");
    });
  });

  it("value as of a date ignores later records", () => {
    const input = {
      confirmations: [confirm("2026-06-01", 200_000)],
      cashFlows: [deposit("2026-01-01", 100_000), deposit("2026-08-01", 40_000)],
      rates: [rate("2026-01-01", 0.2), rate("2026-05-01", 0.5)],
    };
    const early = est({ ...input, asOf: "2026-04-01" });
    expect(early.value).toBe(est({ cashFlows: [input.cashFlows[0]], rates: [input.rates[0]], asOf: "2026-04-01" }).value);
    expect(early.basis).toBe(egp(100_000));
    expect(est({ ...input, asOf: "2026-07-01" }).basis).toBe(egp(100_000));
    expect(est({ ...input, asOf: "2026-08-01" }).basis).toBe(egp(140_000));
  });

  it("empty history is worth nothing", () => {
    expect(est({ asOf: "2026-01-01" })).toEqual({ value: 0, basis: 0, growth: 0, label: "estimated", anchorDate: null });
  });

  it("basis is deposits minus withdrawals and never negative; growth can be negative", () => {
    const r = est({ cashFlows: [deposit("2026-01-01", 1_000), withdraw("2026-01-02", 1_500)], asOf: "2026-01-02" });
    expect(r.basis).toBe(0);
    const loss = est({ cashFlows: [deposit("2026-01-01", 1_000)], rates: [rate("2026-01-01", -0.5)], asOf: "2027-01-01" });
    expect(loss).toMatchObject({ value: egp(500), basis: egp(1_000), growth: -egp(500) });
  });

  it.each([
    ["a zero deposit", () => est({ cashFlows: [{ ...deposit("2026-01-01", 1), amount: 0 }], asOf: "2026-01-01" })],
    ["a fractional-piaster deposit", () => est({ cashFlows: [{ ...deposit("2026-01-01", 1), amount: 1.5 }], asOf: "2026-01-01" })],
    ["a negative confirmed value", () => est({ confirmations: [{ ...confirm("2026-01-01", 1), value: -1 }], asOf: "2026-01-01" })],
  ])("refuses %s", (_name, fn) => {
    expect(fn).toThrow(RangeError);
  });
});

describe("withdrawals", () => {
  it.each([
    ["within the value", egp(1_000), egp(1_500), { ok: true }],
    ["exactly the value", egp(1_500), egp(1_500), { ok: true }],
    ["one piaster above", egp(1_500) + 1, egp(1_500), { ok: false, error: "exceeds-value", value: egp(1_500) }],
    ["from an empty cloud", 1, 0, { ok: false, error: "exceeds-value", value: 0 }],
    ["zero", 0, egp(1_500), { ok: false, error: "invalid-amount" }],
    ["negative", -1, egp(1_500), { ok: false, error: "invalid-amount" }],
  ])("validateWithdrawal %s", (_name, amount, value, expected) => {
    expect(validateWithdrawal(amount, value)).toEqual(expected);
  });

  it("a withdrawal above the estimated value at its date is refused", () => {
    const cashFlows = [deposit("2026-01-01", 100_000)];
    const value = est({ cashFlows, rates: at20, asOf: "2026-07-02" }).value; // 109,517.16
    expect(validateWithdrawal(egp(110_000), value)).toMatchObject({ ok: false, error: "exceeds-value" });
    expect(validateWithdrawal(value, value)).toEqual({ ok: true });
  });

  describe("validateCloudHistory", () => {
    const base = { confirmations: [], rates: at20 };

    it.each([
      ["a withdrawal the deposit covers", [deposit("2026-01-01", 100_000), withdraw("2026-07-02", 109_000)], true],
      ["a withdrawal above value, a day after the deposit", [deposit("2026-01-01", 100_000), withdraw("2026-01-02", 101_000)], false],
      ["a withdrawal with nothing deposited (a void of the deposit)", [withdraw("2026-07-02", 10)], false],
      ["a back-dated withdrawal before the deposit", [deposit("2026-03-01", 100_000), withdraw("2026-02-01", 1_000)], false],
      ["two withdrawals that together overdraw", [deposit("2026-01-01", 100_000), withdraw("2026-01-02", 60_000), withdraw("2026-01-03", 60_000)], false],
      ["a later deposit cannot cover an earlier withdrawal", [withdraw("2026-01-02", 50_000), deposit("2026-01-03", 100_000)], false],
    ] as [string, CashFlow[], boolean][])("%s", (_name, cashFlows, ok) => {
      expect(validateCloudHistory({ ...base, cashFlows }).ok).toBe(ok);
    });

    it("reports the date of the offending withdrawal", () => {
      const result = validateCloudHistory({ ...base, cashFlows: [deposit("2026-01-01", 1), withdraw("2026-02-02", 5_000)] });
      expect(result).toMatchObject({ ok: false, date: "2026-02-02" });
    });

    it("a confirmation after the withdrawal does not make it valid or invalid", () => {
      const cashFlows = [deposit("2026-01-01", 100_000), withdraw("2026-01-02", 101_000)];
      expect(validateCloudHistory({ ...base, cashFlows, confirmations: [confirm("2026-03-01", 500_000)] }).ok).toBe(false);
    });
  });
});

describe("cloud growth is market change, not income", () => {
  const tx = (t: Partial<Tx> & Pick<Tx, "type" | "amount" | "date">): Tx => ({ status: "posted", ...t });
  const ledger: Tx[] = [
    tx({ type: "INCOME", amount: egp(30_000), toAccountId: "bank", date: "2026-01-01" }),
    tx({ type: "INVESTMENT_PURCHASE", amount: egp(100_000), fromAccountId: "bank", date: "2026-01-01" }),
  ];
  const cashFlows = [deposit("2026-01-01", 100_000)];

  it("accrual writes no ledger row: income, savings and spending are the same before and after a year of growth", () => {
    const year = periodSummary(filterByDateRange(ledger, "2026-01-01", "2026-12-31"));
    expect(est({ cashFlows, rates: at20, asOf: "2026-12-31" }).growth).toBeGreaterThan(0);
    expect(year).toMatchObject({ investmentIncome: 0, totalIncome: egp(30_000), spending: 0, savings: egp(30_000), netInvested: egp(100_000) });
    expect(periodSummary(ledger)).toEqual(year);
  });

  it("the growth shows up as market change", () => {
    const start = est({ cashFlows, rates: at20, asOf: "2026-01-01" }).value;
    const end = est({ cashFlows, rates: at20, asOf: "2027-01-01" }).value;
    const netInvested = periodSummary(filterByDateRange(ledger, "2026-01-02", "2027-01-01")).netInvested;
    expect(netInvested).toBe(0); // the deposit was on the first day
    expect(marketChange(start, end, netInvested)).toBe(egp(20_000));
    expect(est({ cashFlows, rates: at20, asOf: "2027-01-01" }).growth).toBe(egp(20_000));
  });
});

describe("cloudProjection", () => {
  it.each([
    ["no contribution: 12 months at 20% APY", egp(100_000), 0.2, null, 12, 12_000_000, 0],
    ["monthly 5,000", egp(100_000), 0.2, { amount: egp(5_000), frequency: "monthly" as const }, 12, 18_531_905, 500_000], // 185,319.05
    ["weekly 1,000 is 52/12 of it a month", egp(100_000), 0.2, { amount: egp(1_000), frequency: "weekly" as const }, 12, 17_660_980, 433_333],
    ["an unset APY is 0, so contributions only", egp(100_000), null, { amount: egp(5_000), frequency: "monthly" as const }, 12, 16_000_000, 500_000],
    ["zero months", egp(100_000), 0.2, { amount: egp(5_000), frequency: "monthly" as const }, 0, 10_000_000, 500_000],
  ])("%s", (_name, value, apy, contribution, months, projected, monthly) => {
    expect(cloudProjection({ value, apy, contribution, months })).toEqual({ projected, monthlyContribution: monthly, label: "expected" });
  });
});

describe("staleness", () => {
  const confirmations = [confirm("2026-01-01", 1_000), confirm("2026-03-01", 1_100)];

  it.each([
    ["2026-03-31", 30, 30, false], // exactly 30 days is fresh
    ["2026-04-01", 30, 31, true],
    ["2026-03-01", 30, 0, false],
    ["2026-02-15", 30, 45, true], // the March confirmation does not exist yet
  ])("today %s with N=%i -> %i days, stale %s", (today, n, days, stale) => {
    expect(cloudStaleness(confirmations, today, n)).toEqual({ days, stale });
  });

  it("never confirmed is stale with unknown age", () => {
    expect(cloudStaleness([], "2026-03-01", 30)).toEqual({ days: null, stale: true });
  });

  it("cloudLine: a cloud worth nothing is never stale; a held one follows its confirmation", () => {
    const empty = cloudLine({ id: "c", confirmations: [], cashFlows: [], rates: [], today: "2026-03-01" });
    expect(empty).toMatchObject({ id: "c", value: 0, stale: false });
    const held = cloudLine({ id: "c", confirmations: [], cashFlows: [deposit("2026-01-01", 1_000)], rates: at20, today: "2026-03-01" });
    expect(held).toMatchObject({ stale: true, days: null, label: "estimated" });
    const fresh = cloudLine({ id: "c", confirmations: [confirm("2026-02-20", 1_000)], cashFlows: [], rates: [], today: "2026-03-01" });
    expect(fresh).toMatchObject({ stale: false, days: 9, label: "estimated" });
  });
});
