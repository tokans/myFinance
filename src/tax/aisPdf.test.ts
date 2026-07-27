import { describe, expect, it } from "vitest";
import { aisPdfToIncomeRows, aisPdfToPaymentRows, aisPdfToRefundRows, aisPdfToSftRows, type AisPdfParseResult } from "./aisPdf";
import type { AisSourceDetailResult } from "./aisSourceDetailPdf";

const emptySourceDetail: AisSourceDetailResult = { tdsTcs: [], sft: [], warnings: [] };

function result(overrides: Partial<AisPdfParseResult>): AisPdfParseResult {
  return {
    rows: [],
    paymentRows: [],
    refundRows: [],
    warnings: [],
        sourceDetail: emptySourceDetail,
    ...overrides,
  };
}

describe("aisPdfToIncomeRows", () => {
  it("maps categories with a positive amount onto other_sources income rows", () => {
    const rows = aisPdfToIncomeRows(
      result({
        rows: [
          { category: "Interest from Savings Bank", amount: 12000 },
          { category: "Zero entry", amount: 0 },
          { category: "No amount parsed", amount: null },
        ],
      }),
      "2026-27",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ay: "2026-27",
      head: "other_sources",
      label: "Interest from Savings Bank",
      amount: 12000,
      source_path: "AIS-PDF",
    });
  });

  it("maps a dividend category onto a dividend income row", () => {
    const rows = aisPdfToIncomeRows(result({ rows: [{ category: "Dividend", amount: 5000 }] }), "2026-27");
    expect(rows[0]).toMatchObject({ head: "dividend", label: "Dividend" });
  });

  it("maps a salary category onto a salary income row (previously fell through to other_sources)", () => {
    const rows = aisPdfToIncomeRows(
      result({ rows: [{ category: "Salary received (Section 192)", amount: 1234567 }] }),
      "2026-27",
    );
    expect(rows[0]).toMatchObject({ head: "salary" });
  });
});

describe("aisPdfToPaymentRows", () => {
  it("maps Part B3 challans onto advance-tax payment rows", () => {
    const rows = aisPdfToPaymentRows(result({ paymentRows: [{ amount: 200000, date: "2026-03-11" }] }), "2026-27");

    expect(rows).toEqual([
      {
        ay: "2026-27",
        type: "advance",
        payer_name: null,
        amount: 200000,
        source_path: "AIS-PDF",
        note: "Advance-tax challan deposited 2026-03-11, from AIS PDF Part B3.",
      },
    ]);
  });

  it("sums a source's Active-only per-transaction TDS deducted into a payer-tagged tds_other payment row, skipping Inactive (superseded) transactions", () => {
    const rows = aisPdfToPaymentRows(
      result({
        sourceDetail: {
          tdsTcs: [
            {
              code: "TDS-194A",
              category: 'Interest other than "Interest on Securities" received (Section 194A)',
              source: "EXAMPLE BANK LIMITED (MUMB00002B)",
              sourceName: "EXAMPLE BANK LIMITED",
              sourceId: "MUMB00002B",
              count: 2,
              amount: 818940,
              transactions: [
                { date: "2026-03-31", amount: 211981, tdsDeducted: 21198, status: "Active", raw: {} },
                { date: "2025-12-31", amount: 207808, tdsDeducted: 20780, status: "Inactive", raw: {} },
              ],
            },
          ],
          sft: [],
          warnings: [],
        },
      }),
      "2026-27",
    );

    expect(rows).toEqual([
      {
        ay: "2026-27",
        type: "tds_other",
        payer_name: "EXAMPLE BANK LIMITED",
        amount: 21198,
        source_path: "AIS-PDF",
        note: "TDS/TCS withheld, from AIS PDF Part B1 (per-source detail).",
      },
    ]);
  });

  it("classifies a salary-category source's TDS as tds_salary and skips a source with zero Active TDS", () => {
    const rows = aisPdfToPaymentRows(
      result({
        sourceDetail: {
          tdsTcs: [
            {
              code: "TDS-192",
              category: "Salary received (Section 192)",
              source: "FIRST BROKERAGE LIMITED (MUMA00001A)",
              sourceName: "FIRST BROKERAGE LIMITED",
              sourceId: "MUMA00001A",
              count: 1,
              amount: 1234567,
              transactions: [{ date: "2026-03-31", amount: 1146664, tdsDeducted: 364740, status: "Active", raw: {} }],
            },
            {
              code: "TDS-194",
              category: "Dividend received (Section 194)",
              source: "EXAMPLE MOTORS LIMITED (CHEC00003C)",
              sourceName: "EXAMPLE MOTORS LIMITED",
              sourceId: "CHEC00003C",
              count: 1,
              amount: 1392,
              transactions: [{ date: "2026-03-31", amount: 1392, tdsDeducted: 0, status: "Active", raw: {} }],
            },
          ],
          sft: [],
          warnings: [],
        },
      }),
      "2026-27",
    );

    expect(rows).toEqual([
      {
        ay: "2026-27",
        type: "tds_salary",
        payer_name: "FIRST BROKERAGE LIMITED",
        amount: 364740,
        source_path: "AIS-PDF",
        note: "TDS/TCS withheld, from AIS PDF Part B1 (per-source detail).",
      },
    ]);
  });
});

describe("aisPdfToRefundRows", () => {
  it("maps Part B4 refunds onto refund rows", () => {
    const rows = aisPdfToRefundRows(
      result({ refundRows: [{ mode: "ECS", nature: "ECS (direct credit to bank account)", amount: 15840, date: "2025-11-19" }] }),
      "2026-27",
    );

    expect(rows).toEqual([
      {
        ay: "2026-27",
        amount: 15840,
        mode: "ECS",
        refund_date: "2025-11-19",
        source_path: "AIS-PDF",
        note: "ECS (direct credit to bank account)",
      },
    ]);
  });
});

describe("aisPdfToSftRows", () => {
  it("maps Part B2 (SFT) source entries onto ais_sft-shaped rows (source-level aggregate, date always null), skipping a zero/null-amount entry", () => {
    const rows = aisPdfToSftRows(
      result({
        sourceDetail: {
          tdsTcs: [],
          sft: [
            {
              code: "SFT-015",
              category: "Dividend income (SFT-015)",
              source: "EXAMPLE POWER CORP LTD (AAACB1111B.XX000)",
              sourceName: "EXAMPLE POWER CORP LTD",
              sourceId: "AAACB1111B.XX000",
              count: 1,
              amount: 5000,
              transactions: [{ date: "2026-05-05", amount: 5000, tdsDeducted: null, status: "Active", raw: {} }],
            },
            {
              code: "SFT-016(SB)",
              category: "Interest income (SFT-016) – Savings",
              source: null,
              sourceName: null,
              sourceId: null,
              count: null,
              amount: null,
              transactions: [],
            },
          ],
          warnings: [],
        },
      }),
    );

    expect(rows).toEqual([
      { sftCode: "SFT-015", description: "Dividend income (SFT-015)", reportingEntity: "EXAMPLE POWER CORP LTD", amount: 5000, date: null },
    ]);
  });
});
