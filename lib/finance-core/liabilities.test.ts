import { describe, expect, it } from "vitest";
import { type Tx, accountBalance, netWorth, periodSummary } from "./ledger";
import { liabilityAdjustments, outstanding, totalLiabilities, validatePayment } from "./liabilities";
import { egpToPiasters as egp } from "./money";

const upd = (date: string, deltaEgp: number) => ({ date, delta: egp(deltaEgp) });
const pay = (date: string, amountEgp: number) => ({ date, amount: egp(amountEgp) });

describe("outstanding", () => {
  const updates = [upd("2026-02-10", 3_000), upd("2026-04-01", -500)];
  const payments = [pay("2026-02-01", 4_000), pay("2026-03-01", 4_000)];

  it.each([
    ["opening only, before anything happens", "2026-01-31", egp(50_000)],
    ["after the first payment", "2026-02-01", egp(46_000)],
    ["after borrowing more, which moves no cash", "2026-02-10", egp(49_000)],
    ["after the second payment", "2026-03-01", egp(45_000)],
    ["after a correction downwards", "2026-04-01", egp(44_500)],
    ["no asOf counts everything", undefined, egp(44_500)],
  ])("%s", (_name, asOf, expected) => {
    expect(outstanding(egp(50_000), updates, payments, asOf)).toBe(expected);
  });

  it("is never negative", () => {
    expect(outstanding(egp(1_000), [upd("2026-02-01", -2_000)], [])).toBe(0);
    expect(outstanding(egp(1_000), [], [pay("2026-02-01", 1_500)])).toBe(0);
  });

  it("totalLiabilities sums the balances", () => {
    expect(totalLiabilities([egp(100), egp(250), 0])).toBe(egp(350));
    expect(totalLiabilities([])).toBe(0);
  });
});

describe("validatePayment", () => {
  it.each([
    ["principal within the balance", egp(4_000), egp(300), egp(46_000), { ok: true }],
    ["principal equal to the balance clears it", egp(46_000), 0, egp(46_000), { ok: true }],
    ["principal one piaster above the balance", egp(46_000) + 1, 0, egp(46_000), { ok: false, error: "exceeds-outstanding", outstanding: egp(46_000) }],
    ["interest is not limited by the balance", egp(100), egp(90_000), egp(100), { ok: true }],
    ["zero principal", 0, egp(300), egp(46_000), { ok: false, error: "invalid-principal" }],
    ["negative principal", -1, 0, egp(46_000), { ok: false, error: "invalid-principal" }],
    ["fractional piasters", 1.5, 0, egp(46_000), { ok: false, error: "invalid-principal" }],
    ["negative interest", egp(100), -1, egp(46_000), { ok: false, error: "invalid-interest" }],
    ["anything against a cleared liability", 1, 0, 0, { ok: false, error: "exceeds-outstanding", outstanding: 0 }],
  ])("%s", (_name, principal, interest, balance, expected) => {
    expect(validatePayment(principal, interest, balance)).toEqual(expected);
  });
});

describe("a loan payment in the ledger", () => {
  const tx = (t: Partial<Tx> & Pick<Tx, "type" | "amount" | "date">): Tx => ({ status: "posted", ...t });
  // One payment action: 4,000 principal and 500 interest, as the two rows the action writes.
  const rows: Tx[] = [
    tx({ type: "LIABILITY_PAYMENT", amount: egp(4_000), fromAccountId: "bank", date: "2026-03-05" }),
    tx({ type: "EXPENSE", amount: egp(500), fromAccountId: "bank", date: "2026-03-05" }),
  ];

  it("principal is not spending, interest is", () => {
    expect(periodSummary(rows)).toMatchObject({ spending: egp(500), liabilityPrincipalPaid: egp(4_000), savings: -egp(500) });
  });

  it("both leave the bank, but only the principal reduces what is owed", () => {
    expect(accountBalance(egp(20_000), "bank", rows)).toBe(egp(15_500));
    const before = netWorth({ cash: egp(20_000), holdings: 0, liabilities: egp(50_000) });
    const after = netWorth({ cash: egp(15_500), holdings: 0, liabilities: outstanding(egp(50_000), [], [pay("2026-03-05", 4_000)]) });
    expect(after - before).toBe(-egp(500)); // exactly the interest
  });
});

describe("a manual liability update", () => {
  it("lowers net worth when it adds debt, with no cash moving", () => {
    const updates = [upd("2026-03-20", 3_000)];
    const before = netWorth({ cash: egp(20_000), holdings: 0, liabilities: outstanding(egp(50_000), updates, [], "2026-03-19") });
    const after = netWorth({ cash: egp(20_000), holdings: 0, liabilities: outstanding(egp(50_000), updates, [], "2026-03-20") });
    expect(after - before).toBe(-egp(3_000));
  });

  it.each([
    [[upd("2026-03-20", 3_000)], -egp(3_000)],
    [[upd("2026-03-20", -200)], egp(200)],
    [[upd("2026-03-20", 3_000), upd("2026-03-21", -200), upd("2026-04-01", 999)], -egp(2_800)], // April is outside March
    [[upd("2026-02-28", 3_000)], 0],
    [[], 0],
  ])("liabilityAdjustments %j -> %i", (updates, expected) => {
    expect(liabilityAdjustments(updates, { start: "2026-03-01", end: "2026-03-31" })).toBe(expected);
  });
});
