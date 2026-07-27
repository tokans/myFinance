import { describe, expect, it } from "vitest";
import { form26asToIncomeRows, form26asToPaymentRows } from "./pdf26as";

describe("form26asToPaymentRows", () => {
  it("maps parsed rows onto tds_other payment rows, skipping zero/missing TDS", () => {
    const payments = form26asToPaymentRows(
      {
        rows: [
          { deductorName: "ACME Corp", tan: "ABCD12345E", amountPaid: 600000, taxDeducted: 60000, transactions: [] },
          { deductorName: "No TDS Co", tan: null, amountPaid: 1000, taxDeducted: 0, transactions: [] },
        ],
        warnings: [],
      },
      "2026-27",
    );

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      ay: "2026-27",
      type: "tds_other",
      payer_name: "ACME Corp",
      amount: 60000,
      source_path: "26AS-PDF",
      note: "TAN ABCD12345E",
    });
  });
});

describe("form26asToIncomeRows", () => {
  it("maps each deductor's amountPaid onto an other_sources income row, skipping zero/missing amounts", () => {
    const income = form26asToIncomeRows(
      {
        rows: [
          { deductorName: "ACME Corp", tan: "ABCD12345E", amountPaid: 600000, taxDeducted: 60000, transactions: [] },
          { deductorName: "No Income Co", tan: null, amountPaid: 0, taxDeducted: 0, transactions: [] },
          { deductorName: "", tan: null, amountPaid: 500, taxDeducted: 50, transactions: [] },
        ],
        warnings: [],
      },
      "2026-27",
    );

    expect(income).toHaveLength(2);
    expect(income[0]).toMatchObject({
      ay: "2026-27",
      head: "other_sources",
      label: "ACME Corp",
      amount: 600000,
      source_path: "26AS-PDF",
    });
    expect(income[1].label).toBe("(unknown deductor)");
  });

  it("classifies a deductor row as dividend when a nested transaction reports section 194", () => {
    const income = form26asToIncomeRows(
      {
        rows: [
          {
            deductorName: "Some Company Ltd",
            tan: "ABCD12345E",
            amountPaid: 10000,
            taxDeducted: 1000,
            transactions: [
              { section: "194", transactionDate: "2025-06-01", dateOfBooking: "2025-07-01", status: "F", amountPaid: 10000, taxDeducted: 1000 },
            ],
          },
          {
            deductorName: "HDFC Bank",
            tan: "WXYZ98765F",
            amountPaid: 5000,
            taxDeducted: 500,
            transactions: [
              { section: "194A", transactionDate: "2025-06-01", dateOfBooking: "2025-07-01", status: "F", amountPaid: 5000, taxDeducted: 500 },
            ],
          },
        ],
        warnings: [],
      },
      "2026-27",
    );

    expect(income[0]).toMatchObject({ head: "dividend", label: "Some Company Ltd" });
    expect(income[1]).toMatchObject({ head: "other_sources", label: "HDFC Bank" });
  });
});
