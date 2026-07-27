import { describe, expect, it } from "vitest";
import { capturedOf } from "./reviewCapture";

/** A stand-in for an AIS result: a category summary PLUS the per-source
 *  secondary tables. Every value is invented. */
function aisResult() {
  return {
    rows: [{ category: "Interest from deposit", amount: 1234 }],
    paymentRows: [{ amount: 50000, date: "2025-09-15" }],
    refundRows: [],
    warnings: ["Couldn't find a category for one row — check the parsed document."],
    sourceDetail: {
      warnings: ["No per-source table was found."],
      tdsTcs: [
        {
          code: "TDS-194A",
          category: "Interest other than interest on securities",
          source: "SAMPLE BANK LIMITED (AAAA00000A)",
          sourceName: "SAMPLE BANK LIMITED",
          sourceId: "AAAA00000A",
          count: 1,
          amount: 1234,
          transactions: [{ date: "2025-06-21", amount: 1234, tdsDeducted: 123, status: "Active", raw: {} }],
        },
      ],
      sft: [],
    },
  };
}

describe("capturedOf", () => {
  it("includes the secondary per-source tables, not just the category summary", () => {
    const captured = JSON.stringify(capturedOf(aisResult()));

    // The summary — what the panel used to be given on its own.
    expect(captured).toContain("Interest from deposit");
    // The secondary table: the payer, and the per-transaction figures. Without
    // these the whole lower half of an AIS page renders as un-captured.
    expect(captured).toContain("SAMPLE BANK LIMITED");
    expect(captured).toContain("123");
    expect(captured).toContain("2025-06-21");
    // Part B3 challans too.
    expect(captured).toContain("50000");
  });

  it("strips warnings at both levels so parse prose can't highlight document text", () => {
    const captured = JSON.stringify(capturedOf(aisResult()));

    expect(captured).not.toContain("check the parsed document");
    expect(captured).not.toContain("No per-source table was found");
  });

  it("passes a TIS-shaped result through unchanged apart from its warnings", () => {
    const tis = { rows: [{ category: "Salary", amount: 100 }], paymentRows: [], refundRows: [], warnings: ["w"] };

    expect(capturedOf(tis)).toEqual({ rows: [{ category: "Salary", amount: 100 }], paymentRows: [], refundRows: [] });
  });
});
