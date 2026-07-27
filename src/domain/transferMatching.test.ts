import { describe, expect, it } from "vitest";
import { findSelfTransferCandidates, type MatchableTransaction } from "./transferMatching";

function txn(id: number, accountId: number, date: string, amount: number, direction: "debit" | "credit"): MatchableTransaction {
  return { id, accountId, date, amount, direction };
}

describe("findSelfTransferCandidates", () => {
  it("matches an exact same-day, same-amount cross-account debit/credit pair", () => {
    const rows = [
      txn(1, 1, "2026-01-05", 5000, "debit"),
      txn(2, 2, "2026-01-05", 5000, "credit"),
    ];
    const out = findSelfTransferCandidates(rows);
    expect(out).toEqual([
      { outgoingId: 1, incomingId: 2, outgoingAccountId: 1, incomingAccountId: 2, dateDeltaDays: 0, amountDelta: 0, confidence: 1 },
    ]);
  });

  it("matches a near-miss within the date window and amount tolerance", () => {
    const rows = [
      txn(1, 1, "2026-01-05", 5000, "debit"),
      txn(2, 2, "2026-01-07", 5000.5, "credit"), // 2 days later, 0.5 off — within default tolerances
    ];
    const out = findSelfTransferCandidates(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ outgoingId: 1, incomingId: 2 });
    expect(out[0].confidence).toBeGreaterThan(0);
    expect(out[0].confidence).toBeLessThan(1);
  });

  it("rejects a pair outside the date window", () => {
    const rows = [
      txn(1, 1, "2026-01-01", 5000, "debit"),
      txn(2, 2, "2026-01-10", 5000, "credit"), // 9 days later, default window is 3
    ];
    expect(findSelfTransferCandidates(rows)).toEqual([]);
  });

  it("rejects a pair outside the amount tolerance", () => {
    const rows = [
      txn(1, 1, "2026-01-05", 5000, "debit"),
      txn(2, 2, "2026-01-05", 4000, "credit"),
    ];
    expect(findSelfTransferCandidates(rows)).toEqual([]);
  });

  it("never pairs a debit and credit within the same account", () => {
    const rows = [
      txn(1, 1, "2026-01-05", 5000, "debit"),
      txn(2, 1, "2026-01-05", 5000, "credit"), // same account as #1
    ];
    expect(findSelfTransferCandidates(rows)).toEqual([]);
  });

  it("greedily assigns highest-confidence pairs first among 3+ same-amount/same-day candidates, one-to-one", () => {
    const rows = [
      txn(1, 1, "2026-01-05", 5000, "debit"),
      txn(2, 2, "2026-01-05", 5000, "credit"), // exact match for #1
      txn(3, 3, "2026-01-06", 5000, "credit"), // looser match for #1 (1 day later)
      txn(4, 4, "2026-01-05", 5000, "debit"),  // should pair with the leftover credit (#3)
    ];
    const out = findSelfTransferCandidates(rows);
    expect(out).toHaveLength(2);
    const byOutgoing = new Map(out.map((c) => [c.outgoingId, c]));
    expect(byOutgoing.get(1)).toMatchObject({ incomingId: 2 }); // exact match wins for #1
    expect(byOutgoing.get(4)).toMatchObject({ incomingId: 3 }); // #4 gets the only remaining credit
  });

  it("respects custom dateWindowDays/amountTolerance options", () => {
    const rows = [
      txn(1, 1, "2026-01-01", 1000, "debit"),
      txn(2, 2, "2026-01-06", 1000, "credit"), // 5 days later
    ];
    expect(findSelfTransferCandidates(rows)).toEqual([]);
    expect(findSelfTransferCandidates(rows, { dateWindowDays: 5 })).toHaveLength(1);
  });

  it("returns an empty list when there are no debits or no credits", () => {
    expect(findSelfTransferCandidates([txn(1, 1, "2026-01-05", 100, "debit")])).toEqual([]);
    expect(findSelfTransferCandidates([txn(1, 1, "2026-01-05", 100, "credit")])).toEqual([]);
    expect(findSelfTransferCandidates([])).toEqual([]);
  });
});
