import { describe, expect, it } from "vitest";
import { paymentRowLabel } from "./taxLabels";

describe("paymentRowLabel", () => {
  it("names a TDS row by whoever withheld the tax", () => {
    expect(paymentRowLabel({ type: "tds_salary", payer_name: "Sample Employer Ltd" })).toEqual({
      label: "Sample Employer Ltd",
      sub: "TDS — salary",
    });
  });

  it("names an advance-tax challan by its type — it has no payer BY DESIGN", () => {
    // The filer pays this one directly to the government, so there is no
    // deductor to name. Calling it "(unnamed)" reports a parse failure for a
    // row that is complete, which is how a correctly imported set of AIS
    // Part B3 challans came to look broken.
    expect(paymentRowLabel({ type: "advance", payer_name: null })).toEqual({
      label: "Advance tax",
      sub: "Paid by you",
    });
    expect(paymentRowLabel({ type: "self_assessment", payer_name: null })).toEqual({
      label: "Self-assessment tax",
      sub: "Paid by you",
    });
  });

  it("still flags a TDS/TCS row with no payer — there, a missing name is a real gap", () => {
    expect(paymentRowLabel({ type: "tds_other", payer_name: null }).label).toBe("(unnamed)");
    expect(paymentRowLabel({ type: "tcs", payer_name: "   " }).label).toBe("(unnamed)");
  });
});
