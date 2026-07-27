/**
 * What survives here is the part that is genuinely about bank statements:
 * deciding which header label means which field, and letting an institution's
 * template override that.
 *
 * Header-row detection and x-position column snapping used to be tested here
 * too. They moved into `@scandoc/core/docmodel` and are covered by its own
 * tests — duplicating them against this thin classifier would only assert
 * that the library still works.
 */
import { describe, expect, it } from "vitest";
import { statementColumnClassifier } from "./columnDetect";

const HDFC_HEADERS = ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"];
const GENERIC_HEADERS = ["Date", "Description", "Debit", "Credit", "Balance"];

function kinds(headers: string[], institution?: string | null) {
  const { classify } = statementColumnClassifier(institution);
  return headers.map(classify);
}

describe("statementColumnClassifier", () => {
  it("classifies a standard header row", () => {
    expect(kinds(GENERIC_HEADERS)).toEqual(["date", "description", "debit", "credit", "balance"]);
  });

  it("reports no template for an unknown or unset institution, and classifies identically", () => {
    const unset = statementColumnClassifier();
    const unknown = statementColumnClassifier("Some Random Bank Nobody Has A Template For");

    expect(HDFC_HEADERS.map(unset.classify)).toEqual(HDFC_HEADERS.map(unknown.classify));
    expect(unset.applied()).toBe(false);
    expect(unknown.applied()).toBe(false);
  });

  it("applies a registered institution template's column labels", () => {
    const { classify, applied } = statementColumnClassifier("HDFC Bank");
    const result = HDFC_HEADERS.map(classify);

    expect(applied()).toBe(true);
    expect(result).toEqual(["date", "description", "debit", "credit", "balance"]);
  });

  it("falls through to the generic classifier for a kind the template doesn't cover", () => {
    // HDFC's template has no override for "date" — the generic match must still apply.
    expect(kinds(["Value Date", ...HDFC_HEADERS.slice(1)], "HDFC Bank")).toEqual([
      "date",
      "description",
      "debit",
      "credit",
      "balance",
    ]);
  });

  it("returns null for a header that means nothing to a statement", () => {
    expect(kinds(["Sr. No.", ""])).toEqual([null, null]);
  });
});
