import { describe, expect, it } from "vitest";
import { checkDepositConsistency, form16ToPaymentRows, type Form16ParseResult } from "./form16";

function baseResult(overrides: Partial<Form16ParseResult> = {}): Form16ParseResult {
  return {
    header: { certificateNumber: null, employerName: null, employerPan: null, tan: null, employeePan: null, assessmentYear: null },
    quarters: [],
    taxDeposits: [],
    partB: [],
    warnings: [],
    ...overrides,
  };
}

describe("form16ToPaymentRows", () => {
  it("sums quarterly tax deducted into a single tds_salary payment row", () => {
    const result = baseResult({
      header: { certificateNumber: "ABCDEFG", employerName: "ACME Corp Pvt Ltd", employerPan: "AAACA0000A", tan: "ABCD12345E", employeePan: "AAAPA0000A", assessmentYear: "2026-27" },
      quarters: [
        { quarter: "Q1", amountPaid: 100000, taxDeducted: 10000, taxDeposited: 10000 },
        { quarter: "Q2", amountPaid: 100000, taxDeducted: 15000, taxDeposited: 15000 },
      ],
    });

    const payments = form16ToPaymentRows(result, "2026-27");

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      ay: "2026-27",
      type: "tds_salary",
      payer_name: "ACME Corp Pvt Ltd",
      amount: 25000,
      source_path: "Form16-PDF",
      note: "TAN ABCD12345E",
    });
  });

  it("returns nothing when no tax was deducted", () => {
    const result = baseResult({ quarters: [{ quarter: "Q1", amountPaid: 100000, taxDeducted: 0, taxDeposited: 0 }] });
    expect(form16ToPaymentRows(result, "2026-27")).toEqual([]);
  });

  it("returns nothing when there are no quarters at all", () => {
    expect(form16ToPaymentRows(baseResult(), "2026-27")).toEqual([]);
  });
});

describe("checkDepositConsistency", () => {
  it("returns null when the quarterly-deposited total matches the deposit ledger", () => {
    const quarters = [{ quarter: "Q1", amountPaid: null, taxDeducted: null, taxDeposited: 25000 }];
    const deposits = [{ slNo: 1, amount: 25000, code: "BSR1", date: "01-01-2026", serialNo: "S1", status: "F" }];
    expect(checkDepositConsistency(quarters, deposits)).toBeNull();
  });

  it("warns when the two totals disagree beyond rounding", () => {
    const quarters = [{ quarter: "Q1", amountPaid: null, taxDeducted: null, taxDeposited: 25000 }];
    const deposits = [{ slNo: 1, amount: 20000, code: "BSR1", date: "01-01-2026", serialNo: "S1", status: "F" }];
    expect(checkDepositConsistency(quarters, deposits)).toMatch(/doesn't match/);
  });

  it("doesn't warn when either side has nothing to compare", () => {
    expect(checkDepositConsistency([], [])).toBeNull();
    const quarters = [{ quarter: "Q1", amountPaid: null, taxDeducted: null, taxDeposited: 25000 }];
    expect(checkDepositConsistency(quarters, [])).toBeNull();
  });
});
