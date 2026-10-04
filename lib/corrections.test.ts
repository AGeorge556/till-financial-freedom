import { describe, expect, it } from "vitest";
import { paymentPair, proposedCloudRecords, proposedHoldingEvents, proposedLiabilityHistory, replacementStamp } from "./corrections";
import { validateCloudHistory } from "./finance-core/clouds";
import { validateLiabilityHistory } from "./finance-core/liabilities";
import { validateHistory } from "./finance-core/portfolio";

const HOLDING = "00000000-0000-4000-8000-000000000001";
const at = (s: string) => new Date(s);

const trade = (id: string, f: Record<string, unknown>) => ({
  id,
  type: "INVESTMENT_PURCHASE" as "INVESTMENT_PURCHASE" | "INVESTMENT_SALE" | "DIVIDEND",
  date: "2026-03-01",
  amount: 100_000,
  status: "posted" as const,
  fee: 0,
  grossAmount: null as number | null,
  taxWithheld: null as number | null,
  holdingId: HOLDING,
  quantity: "10.000000" as string | null,
  unitPrice: "100.000000" as string | null,
  createdAt: at("2026-03-01T09:00:00.000Z"),
  ...f,
});

describe("replacementStamp", () => {
  const old = { date: "2026-03-10", createdAt: at("2026-03-10T09:00:00.000Z") };
  const now = at("2026-04-01T00:00:00.000Z");

  it("keeps the original position when the date is unchanged, and counts as a new entry when it moves", () => {
    expect(replacementStamp(old, "2026-03-10", now)).toBe(old.createdAt);
    expect(replacementStamp(old, "2026-03-11", now)).toBe(now);
  });
});

describe("proposedHoldingEvents", () => {
  // Buy 10 and sell 10 on the same day: the sale needs the buy.
  const history = {
    trades: [
      trade("b", { createdAt: at("2026-03-01T09:00:00.000Z") }),
      trade("s", { type: "INVESTMENT_SALE", amount: 100_000, createdAt: at("2026-03-01T10:00:00.000Z") }),
    ],
    actions: [{ id: "a", holdingId: HOLDING, kind: "BONUS" as const, date: "2026-03-02", quantity: "5.000000", ratio: null, createdAt: at("2026-03-02T09:00:00.000Z") }],
  };

  it("leaves a dropped row out of the history, so removing a buy that a later sale needs is invalid", () => {
    expect(validateHistory(proposedHoldingEvents(history)).ok).toBe(true);
    expect(validateHistory(proposedHoldingEvents(history, { dropTrade: "b" })).ok).toBe(false);
  });

  it("validates an edit as drop plus replacement: a smaller buy fails, a note-only edit that keeps its stamp passes", () => {
    const smaller = trade("new", { quantity: "4.000000", amount: 40_000 });
    expect(validateHistory(proposedHoldingEvents(history, { dropTrade: "b", addTrade: smaller })).ok).toBe(false);

    const sameDay = trade("new", { createdAt: replacementStamp(history.trades[0], "2026-03-01", at("2026-04-01T00:00:00.000Z")) });
    expect(validateHistory(proposedHoldingEvents(history, { dropTrade: "b", addTrade: sameDay })).ok).toBe(true);
    // A fresh createdAt would move the buy behind the same-day sale: the stamp rule is what prevents this refusal.
    const reordered = trade("new", { createdAt: at("2026-04-01T00:00:00.000Z") });
    expect(validateHistory(proposedHoldingEvents(history, { dropTrade: "b", addTrade: reordered })).ok).toBe(false);
  });

  it("drops and replaces a corporate action, and never counts a replaced row twice", () => {
    expect(proposedHoldingEvents(history).filter((e) => e.type === "bonus")).toHaveLength(1);
    const withoutBonus = proposedHoldingEvents(history, { dropAction: "a" });
    expect(withoutBonus.some((e) => e.type === "bonus")).toBe(false);
    const split = { holdingId: HOLDING, kind: "SPLIT" as const, date: "2026-03-02", quantity: null, ratio: "2.000000", createdAt: at("2026-03-02T09:00:00.000Z") };
    const replaced = proposedHoldingEvents(history, { dropAction: "a", addAction: split });
    expect(replaced.filter((e) => e.type === "bonus" || e.type === "split").map((e) => e.type)).toEqual(["split"]);
  });
});

describe("proposedCloudRecords", () => {
  const flow = (id: string, kind: "deposit" | "withdrawal", date: string, amount: number) => ({ id, kind, date, amount, createdAt: `${date}T09:00:00.000Z` });
  const entries = {
    flows: [flow("d", "deposit", "2026-03-01", 1_000_000), flow("w", "withdrawal", "2026-03-10", 800_000)],
    rates: [{ id: "r", date: "2026-03-01", apy: 0.2, createdAt: "2026-03-01T08:00:00.000Z" }],
    confirmations: [{ id: "c", date: "2026-03-05", value: 1_000_000, createdAt: "2026-03-05T08:00:00.000Z" }],
  };

  it("accepts the records as they are and refuses the removal of the deposit a withdrawal needs", () => {
    const bare = { ...entries, confirmations: [] }; // no confirmation: the deposit is all the value there is
    expect(validateCloudHistory(proposedCloudRecords(bare)).ok).toBe(true);
    expect(validateCloudHistory(proposedCloudRecords(bare, { dropFlow: "d" })).ok).toBe(false);
  });

  it("refuses removing a confirmation or a rate change that a withdrawal depends on, and accepts a harmless edit", () => {
    const small = { id: "x", kind: "deposit" as const, date: "2026-03-01", amount: 100_000, createdAt: "2026-03-01T09:00:00.000Z" };
    // Only the confirmation of 10,000.00 covers the 8,000.00 withdrawal once the deposit shrinks.
    const shrunk = { ...entries, flows: [small, entries.flows[1]] };
    expect(validateCloudHistory(proposedCloudRecords(shrunk)).ok).toBe(true);
    expect(validateCloudHistory(proposedCloudRecords(shrunk, { dropConfirmation: "c" })).ok).toBe(false);

    const lowerRate = { date: "2026-03-01", apy: 0.1, createdAt: "2026-03-01T08:00:00.000Z" };
    expect(validateCloudHistory(proposedCloudRecords(entries, { dropRate: "r", addRate: lowerRate })).ok).toBe(true);
    const confirmedLow = { date: "2026-03-05", value: 100_000, createdAt: "2026-03-05T08:00:00.000Z" };
    expect(validateCloudHistory(proposedCloudRecords(entries, { dropConfirmation: "c", addConfirmation: confirmedLow })).ok).toBe(false);
  });

  it("edits a withdrawal as drop plus replacement", () => {
    const bigger = flow("n", "withdrawal", "2026-03-10", 1_000_000);
    const records = proposedCloudRecords(entries, { dropFlow: "w", addFlow: bigger });
    expect(records.cashFlows.map((f) => f.amount)).toEqual([1_000_000, 1_000_000]);
    expect(validateCloudHistory(records).ok).toBe(true);
    const tooBig = flow("n", "withdrawal", "2026-03-10", 10_000_000);
    expect(validateCloudHistory(proposedCloudRecords(entries, { dropFlow: "w", addFlow: tooBig })).ok).toBe(false);
  });
});

describe("proposedLiabilityHistory", () => {
  const history = {
    updates: [{ id: "u", date: "2026-03-01", delta: 500_000 }],
    payments: [{ id: "p", date: "2026-03-10", amount: 1_200_000 }],
  };
  const check = (change: Parameters<typeof proposedLiabilityHistory>[1]) => {
    const { updates, payments } = proposedLiabilityHistory(history, change);
    return validateLiabilityHistory(1_000_000, updates, payments).ok;
  };

  it("refuses removing or shrinking the borrowing that a payment needs, and accepts a payment edited down", () => {
    expect(check({})).toBe(true);
    expect(check({ dropUpdate: "u" })).toBe(false);
    expect(check({ dropUpdate: "u", addUpdate: { date: "2026-03-01", delta: 100_000 } })).toBe(false);
    expect(check({ dropUpdate: "u", addUpdate: { date: "2026-03-20", delta: 500_000 } })).toBe(false); // borrowing dated after the payment
    expect(check({ dropPayments: ["p"], addPayment: { date: "2026-03-10", amount: 300_000 } })).toBe(true);
    expect(check({ dropPayments: ["p"], addPayment: { date: "2026-03-10", amount: 1_600_000 } })).toBe(false);
  });
});

describe("paymentPair", () => {
  const row = (id: string, type: string, f: Record<string, unknown> = {}) => ({
    id,
    type,
    status: "posted",
    date: "2026-03-18",
    fromAccountId: "bank" as string | null,
    createdAt: at("2026-03-18T09:00:00.000Z"),
    ...f,
  });
  const rows = [
    row("p", "LIABILITY_PAYMENT"),
    row("i", "EXPENSE"),
    row("p2", "LIABILITY_PAYMENT", { date: "2026-03-19", createdAt: at("2026-03-19T09:00:00.000Z") }),
    row("old-p", "LIABILITY_PAYMENT", { status: "void" }),
    row("old-i", "EXPENSE", { status: "void" }),
  ];

  it("finds the principal and its interest from either row, and a payment with no interest alone", () => {
    expect(paymentPair(rows, "p")).toMatchObject({ principal: { id: "p" }, interest: { id: "i" } });
    expect(paymentPair(rows, "i")).toMatchObject({ principal: { id: "p" }, interest: { id: "i" } });
    expect(paymentPair(rows, "p2")).toMatchObject({ principal: { id: "p2" }, interest: null });
  });

  it("ignores a voided pair that shares the stamp (a replacement keeps it) and refuses a void or unknown row", () => {
    expect(paymentPair(rows, "old-p")).toBeNull();
    expect(paymentPair(rows, "missing")).toBeNull();
    expect(paymentPair([row("i", "EXPENSE")], "i")).toBeNull(); // an interest row with no principal is not a payment
  });

  it("does not pair rows of another account or day", () => {
    const other = [row("p", "LIABILITY_PAYMENT"), row("i", "EXPENSE", { fromAccountId: "cash" })];
    expect(paymentPair(other, "p")).toMatchObject({ interest: null });
  });
});
