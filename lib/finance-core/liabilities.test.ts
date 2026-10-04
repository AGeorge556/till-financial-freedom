import { describe, expect, it } from "vitest";
import { type Tx, accountBalance, netWorth, periodSummary } from "./ledger";
import { liabilityAdjustments, outstanding, totalLiabilities, validateLiabilityHistory, validatePayment } from "./liabilities";
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

describe("validateLiabilityHistory (date-ordered)", () => {
  const open = egp(1_000);

  it.each([
    ["no records", [], [], true],
    ["a payment within the opening balance", [], [pay("2026-02-01", 1_000)], true],
    ["a payment one piaster above the opening balance", [], [{ date: "2026-02-01", amount: egp(1_000) + 1 }], false],
    ["borrowing first funds a later payment", [upd("2026-02-01", 500)], [pay("2026-02-02", 1_500)], true],
    ["a payment dated BEFORE the borrowing that funds it", [upd("2026-02-02", 500)], [pay("2026-02-01", 1_500)], false],
    ["borrowing and payment on the same day", [upd("2026-02-01", 500)], [pay("2026-02-01", 1_500)], true],
    ["a correction downwards below zero", [upd("2026-02-01", -1_001)], [], false],
    ["paid off, then borrowed again, then paid", [upd("2026-03-01", 200)], [pay("2026-02-01", 1_000), pay("2026-03-02", 200)], true],
  ])("%s", (_name, updates, payments, ok) => {
    expect(validateLiabilityHistory(open, updates, payments).ok).toBe(ok);
  });

  it("names the first offending date and no amount", () => {
    const r = validateLiabilityHistory(open, [upd("2026-02-02", 500)], [pay("2026-02-01", 1_500)]);
    expect(r).toMatchObject({ ok: false, date: "2026-02-01" });
    expect(r.ok === false && /\d,\d|EGP/.test(r.message)).toBe(false);
  });

  it("an accepted history never needs outstanding() to clamp", () => {
    const updates = [upd("2026-02-01", 500), upd("2026-03-10", -100)];
    const payments = [pay("2026-02-05", 900), pay("2026-03-01", 400)];
    expect(validateLiabilityHistory(open, updates, payments).ok).toBe(true);
    for (const d of ["2026-01-01", "2026-02-01", "2026-02-05", "2026-03-01", "2026-03-10", "2026-12-31"]) {
      expect(outstanding(open, updates, payments, d)).toBe(open + updates.filter((u) => u.date <= d).reduce((s, u) => s + u.delta, 0) - payments.filter((p) => p.date <= d).reduce((s, p) => s + p.amount, 0));
    }
  });

  it("outstanding() still clamps legacy data that would go negative", () => {
    expect(outstanding(open, [upd("2026-02-02", 500)], [pay("2026-02-01", 1_500)], "2026-02-01")).toBe(0);
  });
});
