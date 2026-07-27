import { describe, expect, it } from "vitest";
import { parseAisJson } from "./aisParser";

// Minimal fixture mirroring the real AIS Utility JSON (jsonVersion 15.x):
// columnar l2 summary rows + l1 per-transaction detail carrying "TDS Deducted".
const L2_LABELS = [
  "Information Category", "Information Code", "Information Description", "Information Source",
  "Count", "Amount", "Information Category Code", "Derived Amount", "Qualifies For",
];
const L1_LABELS = [
  { field: "tsnId", name: "TSN" },
  { field: "quarter", name: "Quarter" },
  { field: "transactionDate", name: "Date of Payment/Credit" },
  { field: "amtPaid", name: "Amount Paid/Credited" },
  { field: "amountDeducted", name: "TDS Deducted" },
  { field: "amountDeposited", name: "TDS Deposited" },
  { field: "status", name: "Status" },
];

const sample = {
  metadata: { loggedInPan: "ABCDE1234F" },
  header: { columnData: ["2025-26"] },
  partB: {
    sections: [
      {
        sectionKey: "tdsTcs",
        elements: [
          {
            title: "Salary",
            l2: { columnLabel: L2_LABELS, columnData: [["Salary", "TDS-192", "Salary received", "ACME LTD (X)", "2", "9,00,000.00", "SAL", null, ""]] },
            l1: { columnLabel: L1_LABELS, columnData: [
              ["1", "Q1", "01/01/2026", "4,50,000.00", "30,000.00", "30,000.00", "Active"],
              ["2", "Q2", "01/02/2026", "4,50,000.00", "20,000.00", "20,000.00", "Active"],
              // Superseded correction entry — must be excluded from the TDS sum.
              ["3", "Q1", "01/01/2026", "4,50,000.00", "30,000.00", "30,000.00", "Inactive"],
            ] },
          },
          {
            title: "Interest from deposit",
            l2: { columnLabel: L2_LABELS, columnData: [["Interest from deposit", "TDS-194A", "Interest", "EXAMPLE BANK (Y)", "1", "12,000.00", "IND", null, ""]] },
            l1: { columnLabel: L1_LABELS, columnData: [["1", "Q1", "01/01/2026", "12,000.00", "1,200.00", "1,200.00"]] },
          },
          {
            // Dividend with no TDS (no l1) — income only.
            title: "Dividend",
            l2: { columnLabel: L2_LABELS, columnData: [["Dividend", "TDS-194", "Dividend", "TCS LTD (Z)", "1", "5,000.00", "DIV", null, ""]] },
          },
        ],
      },
      {
        // SFT reports the SAME dividend from another source — must be ignored to avoid double-count.
        sectionKey: "sft",
        elements: [
          { title: "Dividend", l2: { columnLabel: L2_LABELS, columnData: [["Dividend", "SFT-015", "Dividend income", "TCS LTD (Z)", "1", "5,000.00", "DIV", null, ""]] } },
        ],
      },
      {
        // Advance-tax challans: columns sit directly on the element (no l2 wrapper).
        sectionKey: "paymentOfTaxes",
        elements: [
          {
            columnLabel: ["Financial Year", "Major Head", "Minor Head", "Tax (A)", "Surcharge (B)", "Education Cess (C)", "Others (D)", "Total (A+B+C+D)", "BSR Code", "Date Of Deposit", "Challan Serial Number", "Challan Identification Number"],
            columnData: [
              ["2025-26", "Income Tax (Other than Companies)", "Advance Tax", "2,00,000", "0", "0", "0", "2,00,000", "0510002", "13/06/2025", "5321", "CIN1"],
              ["2025-26", "Income Tax (Other than Companies)", "Advance Tax", "1,00,000", "0", "0", "0", "1,00,000", "0510002", "13/12/2025", "5322", "CIN2"],
            ],
          },
        ],
      },
    ],
  },
};

describe("parseAisJson (real AIS Utility layout)", () => {
  const r = parseAisJson(sample);

  it("derives AY from the financial year and reads PAN", () => {
    expect(r.ay).toBe("2026-27"); // FY 2025-26 → AY 2026-27
    expect(r.pan).toBe("ABCDE1234F");
  });

  it("aggregates income by head and skips the overlapping SFT section", () => {
    expect(r.income.find((x) => x.head === "salary")?.amount).toBe(900000);
    // Interest 12,000 stays "other_sources"; dividend is its own head, not
    // folded in — and NOT 10,000 (SFT's duplicate 5,000 dividend excluded).
    expect(r.income.find((x) => x.head === "other_sources")?.amount).toBe(12000);
    expect(r.income.find((x) => x.head === "dividend")?.amount).toBe(5000);
    expect(r.recordCount).toBe(3);
    expect(r.unmappedCount).toBe(0);
    expect(r.unnamedPayerCount).toBe(0);
  });

  it("sums only Active TDS transactions (skips Inactive corrections)", () => {
    // 30k + 20k Active; the 30k Inactive row is excluded → 50k, not 80k.
    expect(r.payments.find((p) => p.type === "tds_salary")?.amount).toBe(50000);
    expect(r.payments.find((p) => p.type === "tds_other")?.amount).toBe(1200);
    expect(r.payments.some((p) => p.payer_name?.includes("ACME"))).toBe(true);
  });

  it("extracts advance / self-assessment tax challans", () => {
    expect(r.payments.find((p) => p.type === "advance")?.amount).toBe(300000); // 2L + 1L
  });

  it("captures the sft section separately, without feeding income/payments", () => {
    expect(r.sft).toEqual([
      { sftCode: "SFT-015", description: "Dividend income", reportingEntity: "TCS LTD (Z)", amount: 5000, date: null },
    ]);
    // Still exactly 5,000 dividend income from tdsTcs — the SFT row above must not add a second 5,000.
    expect(r.income.find((x) => x.head === "dividend")?.amount).toBe(5000);
  });
});
