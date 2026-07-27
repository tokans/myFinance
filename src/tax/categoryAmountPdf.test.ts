import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { CATEGORY_AMOUNT_DOC_OPTIONS, parseCategoryAmountDoc } from "./categoryAmountPdf";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";
import type { PdfTableRow } from "@/statements/types";

/**
 * The row fixtures below are the valuable part of this file — each one is a
 * reduced repro of a real AIS/TIS layout that broke the parser. They are kept
 * verbatim through the migration to the DocModel pipeline; only the seam
 * changed, so a regression in structuring shows up here as a failing
 * assertion rather than as a silently different code path.
 */
function parseCategoryAmountTable(rows: PdfTableRow[]) {
  const model = buildDocModel(
    { doc: fromNativeRows(rows), filename: "fixture.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate, ...CATEGORY_AMOUNT_DOC_OPTIONS },
  );
  return parseCategoryAmountDoc(model);
}

function row(rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: 20 })),
  };
}

/** Like `row`, but with an explicit per-cell width — needed to reproduce
 *  TIS's real column spans, where a wide glued header cell (e.g. "SR. NO.
 *  INFORMATION CATEGORY", width 133) makes `nearestColumn`'s span-containment
 *  check swallow a narrow SR.No. cell that sits well inside it. */
function rowW(rowIndex: number, cells: [string, number, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x, width]) => ({ text, x, width })),
  };
}

describe("parseCategoryAmountTable", () => {
  it("parses an Information Category / Amount summary table", () => {
    const rows = [
      row(0, [["Information Category", 10], ["Amount", 300]]),
      row(1, [["Interest from Savings Bank", 10], ["12000", 300]]),
      row(2, [["Dividend", 10], ["5000", 300]]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual([
      { category: "Interest from Savings Bank", amount: 12000 },
      { category: "Dividend", amount: 5000 },
    ]);
  });

  it("folds a wrapped category-label continuation row (no category, no amount) onto the previous row, including at a page break where the header repeats", () => {
    const header = (): [string, number][] => [["Information Category", 10], ["Amount", 300]];
    const rows = [
      row(0, header()),
      row(1, [["Interest from Savings Bank", 10], ["12000", 300]]),
      row(2, [["(includes NRE/NRO accounts)", 150]]), // continuation, far enough from either column to not snap into one
      // Page 2 restates the header, starting a new segment.
      row(3, header()),
      row(4, [["and fixed deposits", 150]]), // continuation, first row of the new segment
      row(5, [["Dividend", 10], ["5000", 300]]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([
      { category: "Interest from Savings Bank (includes NRE/NRO accounts) and fixed deposits", amount: 12000 },
      { category: "Dividend", amount: 5000 },
    ]);
  });

  it("caps how many consecutive lines fold onto a category, so an unrelated multi-line block (e.g. a restated name/address block between pages) can't corrupt it indefinitely", () => {
    const header = (): [string, number][] => [["Information Category", 10], ["Amount", 300]];
    const rows = [
      row(0, header()),
      row(1, [["Interest from Savings Bank", 10], ["12000", 300]]),
      row(2, [["Assessee Name Line", 150]]),
      row(3, [["Assessee Address Line One", 150]]),
      row(4, [["Assessee Address Line Two", 150]]),
      row(5, [["Dividend", 10], ["5000", 300]]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([
      { category: "Interest from Savings Bank Assessee Name Line Assessee Address Line One", amount: 12000 },
      { category: "Dividend", amount: 5000 },
    ]);
  });

  it("doesn't treat a row as a real category entry just because SOME text landed in the amount column band — it must actually parse as an amount", () => {
    const header = (): [string, number][] => [["Information Category", 10], ["Amount", 300]];
    const rows = [
      row(0, header()),
      row(1, [["Interest from Savings Bank", 10], ["12000", 300]]),
      row(2, [["Ref: XYZ", 305]]), // unparseable text landing near the amount column, not a number
      row(3, [["Dividend", 10], ["5000", 300]]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([
      { category: "Interest from Savings Bank Ref: XYZ", amount: 12000 },
      { category: "Dividend", amount: 5000 },
    ]);
  });

  it("warns when no category column is found", () => {
    const rows = [row(0, [["Something else", 10]])];
    const result = parseCategoryAmountTable(rows);
    expect(result.warnings.some((w) => w.includes("Information Category"))).toBe(true);
  });

  it("extracts Part B3 advance-tax challans structurally instead of mis-attributing them to a prior category/amount segment", () => {
    // Reduced repro of the real AIS-PDF bug: a category/amount segment (e.g.
    // Part B7) is immediately followed by Part B3, whose header has no
    // category/amount vocabulary at all. Before the fix, Part B3's rows
    // bled into Part B7's stale columns and either vanished or corrupted a
    // category entry with `amount: null`.
    const header = (): [string, number][] => [["Information Category", 10], ["Amount", 900]];
    const rows = [
      row(0, header()),
      row(1, [["Dividend", 10], ["5000", 900]]),
      row(2, [["Part B3-Information relating to payment of taxes", 10]]),
      row(3, [
        ["SR. NO. FINANCIAL", 15], ["MAJOR HEAD MINOR HEAD", 109], ["TAX (A)", 237],
        ["SURCHARGE (B) EDUCATION", 301], ["OTHERS (D)", 431], ["TOTAL (A+B+C", 518],
        ["BSR CODE", 587], ["DATE OF", 651], ["CHALLAN", 715], ["CHALLAN IDENTIFICATION NUMBER", 774],
      ]),
      row(4, [
        ["1", 15], ["2025-26", 50], ["Income Tax", 109], ["Advance Tax", 173],
        ["2,00,000", 262], ["0", 357], ["0", 418], ["0", 505],
        ["2,00,000 0510002", 548], ["11/03/2026", 651], ["939", 715], ["26031100005515HDFC", 774],
      ]),
      row(5, [
        ["2", 15], ["2025-26", 50], ["Income Tax", 109], ["Advance Tax", 173],
        ["1,50,000", 262], ["0", 357], ["0", 418], ["0", 505],
        ["1,50,000 0510002", 548], ["13/12/2025", 651], ["16128", 715], ["25121300079551HDFC", 774],
      ]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([{ category: "Dividend", amount: 5000 }]);
    expect(result.paymentRows).toEqual([
      { amount: 200000, date: "2026-03-11" },
      { amount: 150000, date: "2025-12-13" },
    ]);
  });

  it("extracts Part B4 refunds structurally, splitting the glued 'amount date' cell", () => {
    const rows = [
      row(0, [["Part B4-Information relating to demand and refund", 10]]),
      row(1, [["SR. NO. FINANCIAL YEAR", 15], ["MODE", 243], ["NATURE OF REFUND", 432], ["REFUND AMOUNT", 621], ["DATE OF PAYMENT", 810]]),
      row(2, [
        ["1", 15], ["2024-25", 54], ["ECS", 243],
        ["ECS (direct credit to bank account)", 432], ["15,840 19/11/2025", 776],
      ]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.refundRows).toEqual([
      { mode: "ECS", nature: "ECS (direct credit to bank account)", amount: 15840, date: "2025-11-19" },
    ]);
  });

  it("still finds Part B3/B4 when the document has no category/amount table at all", () => {
    const rows = [
      row(0, [["Part B3-Information relating to payment of taxes", 10]]),
      row(1, [
        ["SR. NO. FINANCIAL", 15], ["MAJOR HEAD MINOR HEAD", 109], ["TAX (A)", 237],
        ["SURCHARGE (B) EDUCATION", 301], ["OTHERS (D)", 431], ["TOTAL (A+B+C", 518],
        ["BSR CODE", 587], ["DATE OF", 651], ["CHALLAN", 715], ["CHALLAN IDENTIFICATION NUMBER", 774],
      ]),
      row(2, [
        ["1", 15], ["2025-26", 50], ["Income Tax", 109], ["Advance Tax", 173],
        ["2,00,000", 262], ["0", 357], ["0", 418], ["0", 505],
        ["2,00,000 0510002", 548], ["11/03/2026", 651], ["939", 715], ["26031100005515HDFC", 774],
      ]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.paymentRows).toEqual([{ amount: 200000, date: "2026-03-11" }]);
    expect(result.rows).toEqual([]);
  });

  it("drops nested source-wise detail rows (bare dates, account numbers, ALL-CAPS sub-table headers) instead of surfacing them as bogus categories", () => {
    // Reduced repro of the real AIS-PDF bug: each category is immediately
    // followed by its own "Information Source-wise Details" sub-table,
    // whose own header/value rows leaked through as dozens of junk
    // `{category: "...", amount: null}` entries before this fix.
    const header = (): [string, number][] => [["Information Category", 10], ["Amount", 300]];
    const rows = [
      row(0, header()),
      row(1, [["Dividend received (Section 194)", 10], ["6992", 300]]),
      row(2, [["DATE OF PAYMENT/CREDIT", 10]]),
      row(3, [["06/11/2025", 10]]),
      row(4, [["18/07/2025", 10]]),
      row(5, [["Interest income", 10], ["1548", 300]]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([
      { category: "Dividend received (Section 194)", amount: 6992 },
      { category: "Interest income", amount: 1548 },
    ]);
    expect(result.warnings.some((w) => w.includes("nested source-wise detail row"))).toBe(true);
  });

  it("strips the AIS/TIS page-footer boilerplate ('Download ID : ... Generation Date : ..., Page X of Y') glued onto a category label at a page break", () => {
    const header = (): [string, number][] => [["Information Category", 10], ["Amount", 300]];
    const rows = [
      row(0, header()),
      row(1, [
        [
          "Salary (TDS Annexure II) Download ID : AAAPA0000A202607041621 IP Address : 203.0.113.10 Generation Date : 04/07/2026, 16:21:03 Page 6 of 7",
          10,
        ],
        ["1669080", 300],
      ]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([{ category: "Salary (TDS Annexure II)", amount: 1669080 }]);
  });

  it("strips the same footer when the page renders it as separate cells across two rows rather than glued onto a label", () => {
    // A real export lays the footer out this way. Strips run per cell, so a
    // single pattern spanning the whole footer matched only the glued form
    // above — leaving these four cells to be read as a table of their own,
    // carrying the filer's PAN and IP address into the model.
    const rows = [
      row(0, [["Information Category", 10], ["Amount", 300]]),
      row(1, [["Dividend received (Section 194)", 10], ["6992", 300]]),
      row(2, [["Download ID : AAAPA0000A202607041621", 10], ["IP Address : 203.0.113.10", 300]]),
      row(3, [["Generation Date : 04/07/2026, 16:21:03", 10], ["Page 2 of 7", 300]]),
      row(4, [["Interest income", 10], ["1548", 300]]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([
      { category: "Dividend received (Section 194)", amount: 6992 },
      { category: "Interest income", amount: 1548 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/AAAPA0000A|203\.0\.113\.10|Page 2 of 7/);
  });

  it("recognizes TIS's 'Accepted by Taxpayer/Confirmed by Source' value column and strips the glued leading SR.No. digit from the category label", () => {
    // Reduced repro of TIS's real clean summary table (page 1 of a real
    // export): the header's category cell is wide enough to span-contain
    // the SR.No. cell too, and the amount header never contains the literal
    // word "amount" — both of which made the old classifier miss this table
    // entirely (score never reached the header threshold).
    const rows = [
      rowW(0, [
        ["SR. NO. INFORMATION CATEGORY", 15, 133],
        ["PROCESSED BY", 434, 56],
        ["ACCEPTED BY", 528, 51],
      ]),
      rowW(1, [
        ["1", 15, 4],
        ["Salary", 54, 22],
        ["12,34,567", 450, 40],
        ["12,34,567", 539, 40],
      ]),
      rowW(2, [
        ["2", 15, 4],
        ["Dividend", 54, 31],
        ["2,00,842", 460, 30],
        ["2,00,842", 549, 30],
      ]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([
      { category: "Salary", amount: 1234567 },
      { category: "Dividend", amount: 200842 },
    ]);
  });

  it("stops scanning for category/amount rows once TIS's 'Annexure to Taxpayer Information Summary' banner appears, since that section re-derives (and would double-count) the same totals via a much denser multi-line breakdown", () => {
    const rows = [
      rowW(0, [
        ["SR. NO. INFORMATION CATEGORY", 15, 133],
        ["ACCEPTED BY", 528, 51],
      ]),
      rowW(1, [
        ["1", 15, 4],
        ["Salary", 54, 22],
        ["12,34,567", 539, 40],
      ]),
      row(2, [
        [
          "----------------------------------------------------------- Annexure to Taxpayer Information Summary (TIS) -----------------------------------------------------------",
          15,
        ],
      ]),
      rowW(3, [
        ["SR. NO. INFORMATION CATEGORY", 15, 133],
        ["ACCEPTED BY", 528, 51],
      ]),
      rowW(4, [
        ["1", 15, 4],
        ["Salary", 54, 22],
        ["12,34,567", 539, 40],
      ]),
    ];

    const result = parseCategoryAmountTable(rows);

    expect(result.rows).toEqual([{ category: "Salary", amount: 1234567 }]);
  });
});
