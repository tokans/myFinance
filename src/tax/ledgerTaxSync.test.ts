import { describe, expect, it } from "vitest";
import { ayToFyRange, buildLedgerTaxSync } from "./ledgerTaxSync";

describe("ayToFyRange", () => {
  it("maps an AY to the FY it assesses (April-March)", () => {
    expect(ayToFyRange("2026-27")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });

  it("returns null for a malformed AY", () => {
    expect(ayToFyRange("not-an-ay")).toBeNull();
  });
});

describe("buildLedgerTaxSync", () => {
  it("sums categorized credits into dividend/interest income rows, ignoring debits and other categories", () => {
    const result = buildLedgerTaxSync(
      [
        { description: "DIV TCS LTD", credit: 5000, categories: ["dividend_income"] },
        { description: "DIV RELIANCE LTD", credit: 2000, categories: ["dividend_income"] },
        { description: "INT CREDIT SAVINGS", credit: 1200, categories: ["interest_income"] },
        { description: "DIV REVERSAL", credit: null, categories: ["dividend_income"] }, // no credit — skipped
        { description: "SIP ZERODHA", credit: null, categories: ["investment_contribution"] },
        { description: "SWIGGY ORDER", credit: 500, categories: ["dining_food_delivery"] },
      ],
      "2026-27",
    );

    expect(result.dividendTotal).toBe(7000);
    expect(result.interestTotal).toBe(1200);
    expect(result.transactionCount).toBe(3);
    expect(result.incomeRows).toEqual([
      expect.objectContaining({ ay: "2026-27", head: "dividend", amount: 7000, source_path: "LEDGER:dividend_income" }),
      expect.objectContaining({ ay: "2026-27", head: "other_sources", amount: 1200, source_path: "LEDGER:interest_income" }),
    ]);
  });

  it("omits an income row entirely when its category has no credits", () => {
    const result = buildLedgerTaxSync(
      [{ description: "INT CREDIT", credit: 100, categories: ["interest_income"] }],
      "2026-27",
    );
    expect(result.incomeRows).toHaveLength(1);
    expect(result.incomeRows[0].head).toBe("other_sources");
    expect(result.dividendTotal).toBe(0);
  });

  it("sums a transaction tagged with both dividend_income and a rail tag into dividendTotal once", () => {
    const result = buildLedgerTaxSync(
      [{ description: "UPI DIVIDEND TCS LTD", credit: 3000, categories: ["dividend_income", "upi_payment"] }],
      "2026-27",
    );
    expect(result.dividendTotal).toBe(3000);
    expect(result.transactionCount).toBe(1);
  });

  it("flags likely share-sale credits without writing an income row for them", () => {
    const result = buildLedgerTaxSync(
      [
        { description: "MF REDEMPTION GROWW", credit: 50000, categories: [] },
        { description: "NEFT FROM ZERODHA BROKING", credit: 20000, categories: [] },
        { description: "SALARY CREDIT", credit: 90000, categories: ["salary_income"] },
      ],
      "2026-27",
    );

    expect(result.incomeRows).toHaveLength(0);
    expect(result.possibleShareSale.count).toBe(2);
    expect(result.possibleShareSale.sampleDescriptions).toEqual(["MF REDEMPTION GROWW", "NEFT FROM ZERODHA BROKING"]);
  });

  it("never flags a transaction already categorized dividend_income as a possible share sale", () => {
    const result = buildLedgerTaxSync(
      [{ description: "DIV SOLD OFF SHARES LTD", credit: 1000, categories: ["dividend_income"] }],
      "2026-27",
    );
    expect(result.possibleShareSale.count).toBe(0);
  });
});
