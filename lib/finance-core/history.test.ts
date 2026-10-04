import { describe, expect, it } from "vitest";
import { type HistoryData, type HistoryRange, MAX_POINTS, samplingDates, seriesFromSnapshots, snapshotsAsOf } from "./history";
import type { Tx } from "./ledger";
import { egpToPiasters as egp } from "./money";
import { type HoldingEvent, type PriceUpdate, portfolioValue } from "./portfolio";

const TODAY = "2026-10-04";

describe("samplingDates", () => {
  it.each<[HistoryRange, string | null, number, string]>([
    ["7d", "2020-01-01", 8, "2026-09-27"],
    ["1m", "2020-01-01", 31, "2026-09-04"],
    ["3m", "2020-01-01", 93, "2026-07-04"], // daily up to 3 months
    ["6m", "2020-01-01", 28, "2026-04-04"], // weekly: 27 weeks + today
    ["1y", "2020-01-01", 54, "2025-10-04"], // weekly: 53 + today
    ["all", "2020-01-01", 83, "2020-01-01"], // monthly: 82 + today
    ["all", "2026-08-15", 51, "2026-08-15"], // a short history is still daily
    ["all", "2026-03-01", 32, "2026-03-01"], // 217 days: weekly (31 weeks) + today
    ["1y", "2026-09-01", 34, "2026-09-01"], // nothing before the first transaction
    ["all", null, 1, TODAY], // no data yet
    ["7d", TODAY, 1, TODAY], // first transaction today
  ])("%s from %s has %i points, starting %s, ending today", (range, first, count, start) => {
    const d = samplingDates(range, first, TODAY);
    expect(d).toHaveLength(count);
    expect(d[0]).toBe(start);
    expect(d[d.length - 1]).toBe(TODAY);
  });

  it("is strictly ascending with no duplicates", () => {
    for (const r of ["7d", "1m", "3m", "6m", "1y", "all"] as const) {
      const d = samplingDates(r, "2019-05-31", TODAY);
      expect(d).toEqual([...new Set(d)].sort());
    }
  });

  it("is bounded however long the history is, and keeps both ends", () => {
    const d = samplingDates("all", "1980-01-01", TODAY);
    expect(d).toHaveLength(MAX_POINTS);
    expect([d[0], d[d.length - 1]]).toEqual(["1980-01-01", TODAY]);
    for (const first of ["2026-10-03", "2026-07-03", "2025-10-03", "2000-02-29", "1900-01-01"]) {
      expect(samplingDates("all", first, TODAY).length).toBeLessThanOrEqual(MAX_POINTS);
    }
  });

  it("monthly dates keep the first date's day, clamped to short months", () => {
    const d = samplingDates("all", "2024-01-31", "2026-03-15");
    expect(d.slice(0, 4)).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
  });
});

describe("seriesFromSnapshots", () => {
  const snap = { date: "2026-03-01", cash: egp(5_000), cardBalances: [] as number[], investments: egp(20_000), liabilities: egp(8_000) };

  it("net worth is cash + investments - debt", () => {
    expect(seriesFromSnapshots([snap])[0]).toEqual({
      date: "2026-03-01",
      cash: egp(5_000),
      investments: egp(20_000),
      debt: egp(8_000),
      netWorth: egp(17_000),
      stale: false,
    });
  });

  it("a negative credit card is debt (positive figure), a positive one is cash, and net worth is unchanged by the split", () => {
    const [p] = seriesFromSnapshots([{ ...snap, cardBalances: [-egp(1_500), egp(200)] }]);
    expect(p).toMatchObject({ cash: egp(5_200), debt: egp(9_500), netWorth: egp(5_200) + egp(20_000) - egp(9_500) });
    expect(p.netWorth).toBe(snap.cash - egp(1_500) + egp(200) + snap.investments - snap.liabilities);
  });

  it("an overdrawn non-card account lowers cash rather than becoming debt", () => {
    expect(seriesFromSnapshots([{ ...snap, cash: -egp(100) }])[0]).toMatchObject({ cash: -egp(100), debt: egp(8_000) });
  });

  it("carries the stale flag of each date", () => {
    expect(seriesFromSnapshots([{ ...snap, stale: true }, snap]).map((p) => p.stale)).toEqual([true, false]);
  });
});

describe("replaying history (H1)", () => {
  let n = 0;
  const stamp = (date: string) => ({ date, createdAt: `2026-01-01T00:00:${String(n++).padStart(2, "0")}Z` });
  const events: HoldingEvent[] = [{ ...stamp("2026-01-10"), type: "purchase", quantity: "100", price: "10", fee: 0 }];
  const income: Tx = { type: "INCOME", date: "2026-02-15", amount: egp(2_000), toAccountId: "bank", status: "posted" };
  const loan = { opening: egp(500), updates: [], payments: [{ date: "2026-03-01", amount: egp(100) }] };
  const dates = ["2026-01-05", "2026-01-15", "2026-01-25", "2026-02-05", "2026-02-20", "2026-03-05"];

  const series = (prices: PriceUpdate[], txs: Tx[] = [income]) => {
    const data: HistoryData = {
      accounts: [{ id: "bank", opening: egp(1_000), creditCard: false }],
      txs,
      liabilities: [loan],
      investmentsAt: (d) => portfolioValue([{ id: "h", events, priceUpdates: prices }], d, 7),
    };
    return seriesFromSnapshots(snapshotsAsOf(data, dates));
  };
  const base: PriceUpdate[] = [{ date: "2026-02-01", price: "12", createdAt: "2026-02-01T00:00:00Z" }];
  const investments = (s: ReturnType<typeof series>) => s.map((p) => p.investments);

  it("values step from one price to the next with nothing in between", () => {
    // 15 Jan, 25 Jan: no price update yet, valued at the purchase price (10); from 1 Feb at 12.
    expect(investments(series(base))).toEqual([0, egp(1_000), egp(1_000), egp(1_200), egp(1_200), egp(1_200)]);
  });

  it("a back-dated price rewrites the points after it and before the next update, and later points carry forward", () => {
    const before = series(base);
    const after = series([...base, { date: "2026-01-20", price: "15", createdAt: "2026-03-10T00:00:00Z" }]);
    expect(investments(after)).toEqual([0, egp(1_000), egp(1_500), egp(1_200), egp(1_200), egp(1_200)]);
    // only the 25 Jan point moved
    expect(after.map((p, i) => p.netWorth !== before[i].netWorth)).toEqual([false, false, true, false, false, false]);
    expect(after[2].netWorth - before[2].netWorth).toBe(egp(500));
  });

  it("a back-dated transaction changes every later point, and none before it", () => {
    const before = series(base);
    const lunch: Tx = { type: "EXPENSE", date: "2026-01-20", amount: egp(300), fromAccountId: "bank", status: "posted" };
    const after = series(base, [income, lunch]);
    expect(after.map((p, i) => p.cash - before[i].cash)).toEqual([0, 0, -egp(300), -egp(300), -egp(300), -egp(300)]);
  });

  it("pending and void rows change nothing; loans count only from their dated payments", () => {
    const pending: Tx = { ...income, status: "pending" };
    expect(series(base, [pending]).map((p) => p.cash)).toEqual(series(base, []).map((p) => p.cash));
    expect(series(base).map((p) => p.debt)).toEqual([egp(500), egp(500), egp(500), egp(500), egp(500), egp(400)]);
  });

  it("reuses the existing engines: cash 1,000 + 2,000 from 15 Feb, held 1,200, owing 400 at the end", () => {
    expect(series(base)[5]).toMatchObject({ cash: egp(3_000), investments: egp(1_200), debt: egp(400), netWorth: egp(3_800) });
  });

  it("flags stale investment values: a price 7+ days old", () => {
    const s = series(base);
    expect([s[1].stale, s[3].stale, s[5].stale]).toEqual([true, false, true]); // 15 Jan: no price; 5 Feb: 4 days old; 5 Mar: 32 days old
  });
});
