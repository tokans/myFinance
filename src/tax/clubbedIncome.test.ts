import { describe, it, expect } from "vitest";
import {
  splitClubbedIncome, clubbedIncomeRow, clubbedAccountId, clubbedFullAmount,
  CLUBBED_SOURCE_PREFIX, CLUBBED_EXEMPTION_PER_CHILD,
} from "./clubbedIncome";

describe("splitClubbedIncome", () => {
  it("exempts the full amount when under the ₹1,500 cap", () => {
    expect(splitClubbedIncome(1000)).toEqual({ fullAmount: 1000, exemptPortion: 1000, taxablePortion: 0 });
  });

  it("caps the exemption at ₹1,500 and taxes the rest", () => {
    expect(splitClubbedIncome(5000)).toEqual({ fullAmount: 5000, exemptPortion: 1500, taxablePortion: 3500 });
  });

  it("treats exactly the cap as fully exempt", () => {
    expect(splitClubbedIncome(CLUBBED_EXEMPTION_PER_CHILD)).toEqual({
      fullAmount: 1500, exemptPortion: 1500, taxablePortion: 0,
    });
  });

  it("clamps negative/non-finite input to zero", () => {
    expect(splitClubbedIncome(-500)).toEqual({ fullAmount: 0, exemptPortion: 0, taxablePortion: 0 });
    expect(splitClubbedIncome(NaN)).toEqual({ fullAmount: 0, exemptPortion: 0, taxablePortion: 0 });
  });
});

describe("clubbedIncomeRow / clubbedAccountId / clubbedFullAmount", () => {
  const account = { id: 42, name: "Priya's PPF" };

  it("builds a row net of the exemption, tagged with the source account", () => {
    const row = clubbedIncomeRow("2026-27", account, 5000);
    expect(row.ay).toBe("2026-27");
    expect(row.head).toBe("other_sources");
    expect(row.amount).toBe(3500);
    expect(row.source_path).toBe(`${CLUBBED_SOURCE_PREFIX}42`);
    expect(row.label).toContain("Priya's PPF");
    expect(row.note).toBe("full=5000");
  });

  it("round-trips the account id and the pre-exemption amount", () => {
    const row = clubbedIncomeRow("2026-27", account, 5000);
    expect(clubbedAccountId(row.source_path)).toBe(42);
    expect(clubbedFullAmount(row)).toBe(5000);
  });

  it("clubbedAccountId returns null for a non-clubbed source_path", () => {
    expect(clubbedAccountId("MANUAL:other_sources")).toBeNull();
    expect(clubbedAccountId(null)).toBeNull();
  });

  it("clubbedFullAmount falls back to the stored net amount when note isn't the encoded form", () => {
    expect(clubbedFullAmount({ note: "From AIS", amount: 3500 })).toBe(3500);
    expect(clubbedFullAmount({ note: null, amount: 3500 })).toBe(3500);
  });
});
