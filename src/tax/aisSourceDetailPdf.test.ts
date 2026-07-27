import { describe, expect, it } from "vitest";
import { parseAisSourceDetail } from "./aisSourceDetailPdf";
import type { PdfTableRow } from "@/statements/types";

function row(rowIndex: number, cells: [string, number, number?][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x, width]) => ({ text, x, width: width ?? 20 })),
  };
}

/** Reduced repro of a real AIS-PDF export's Part B1 (TDS/TCS) "Salary"
 *  block — source-summary row + a QUARTER/DATE/AMOUNT PAID/TDS DEDUCTED/
 *  STATUS detail table with two transactions (real export has thirteen). */
function tdsTcsSalaryRows(startIndex: number): PdfTableRow[] {
  return [
    row(startIndex, [["Part B1-Information relating to tax deducted or collected at source", 10, 326]]),
    row(startIndex + 1, [["Salary", 10, 27]]),
    row(startIndex + 2, [
      ["SR. NO. INFORMATION CODE", 15, 114],
      ["INFORMATION DESCRIPTION", 253, 105],
      ["INFORMATION SOURCE", 462, 85],
      ["COUNT", 795, 26],
      ["AMOUNT", 901, 33],
    ]),
    row(startIndex + 3, [
      ["1", 15],
      ["TDS-192", 54],
      ["Salary received (Section 192)", 253],
      ["FIRST BROKERAGE LIMITED (MUMA00001A)", 462],
      ["13", 812],
      ["12,34,567", 893],
    ]),
    row(startIndex + 4, [
      ["SR. NO. QUARTER", 15, 74],
      ["DATE OF PAYMENT/CREDIT", 238, 99],
      ["AMOUNT PAID/CREDITED", 435, 92],
      ["TDS DEDUCTED", 619, 57],
      ["TDS DEPOSITED STATUS", 766, 96],
    ]),
    row(startIndex + 5, [
      ["1", 15],
      ["Q4(Jan-Mar)", 54],
      ["31/03/2026", 238],
      ["11,46,664", 492],
      ["3,64,740", 645],
      ["3,64,740 Active", 794],
    ]),
    row(startIndex + 6, [
      ["2", 15],
      ["Q4(Jan-Mar)", 54],
      ["31/03/2026", 238],
      ["2,50,830", 496],
      ["0", 671],
      ["0 Active", 820],
    ]),
  ];
}

describe("parseAisSourceDetail", () => {
  it("extracts a Part B1 (TDS/TCS) source entry with its per-transaction detail (date/amount/TDS/status), splitting the payer name from its TAN", () => {
    const rows = tdsTcsSalaryRows(0);
    const result = parseAisSourceDetail(rows);

    expect(result.sft).toEqual([]);
    expect(result.tdsTcs).toEqual([
      {
        code: "TDS-192",
        category: "Salary received (Section 192)",
        source: "FIRST BROKERAGE LIMITED (MUMA00001A)",
        sourceName: "FIRST BROKERAGE LIMITED",
        sourceId: "MUMA00001A",
        count: 13,
        amount: 1234567,
        transactions: [
          { date: "2026-03-31", amount: 1146664, tdsDeducted: 364740, status: "Active", raw: expect.any(Object) },
          { date: "2026-03-31", amount: 250830, tdsDeducted: 0, status: "Active", raw: expect.any(Object) },
        ],
      },
    ]);
  });

  it("extracts a Part B2 (SFT) source entry via its single glued detail header, bucketed separately from tdsTcs", () => {
    // Reduced repro of the real SFT-015 block, whose detail header is ONE
    // wide glued cell ("SR. NO. REPORTED ON DIVIDEND AMOUNT STATUS") rather
    // than five separate cells — the data rows underneath it are still
    // properly separate cells, which is what this test exercises.
    const rows = [
      row(0, [["Part B2-Information relating to specified financial transaction (SFT)", 10, 331]]),
      row(1, [["Dividend", 10, 38]]),
      row(2, [
        ["SR. NO. INFORMATION CODE", 15, 114],
        ["INFORMATION DESCRIPTION", 253, 105],
        ["INFORMATION SOURCE", 462, 85],
        ["COUNT", 795, 26],
        ["AMOUNT", 901, 33],
      ]),
      row(3, [
        ["1", 15],
        ["SFT-015", 54],
        ["Dividend income (SFT-015)", 253],
        ["EXAMPLE POWER CORP LTD (AAACB1111B.XX000)", 462],
        ["1", 816],
        ["5,000", 910],
      ]),
      row(4, [["SR. NO. REPORTED ON DIVIDEND AMOUNT STATUS", 15, 205]]),
      row(5, [
        ["1", 15],
        ["05/05/2026", 51],
        ["5,000 Active", 159],
      ]),
    ];

    const result = parseAisSourceDetail(rows);

    expect(result.tdsTcs).toEqual([]);
    expect(result.sft).toEqual([
      {
        code: "SFT-015",
        category: "Dividend income (SFT-015)",
        source: "EXAMPLE POWER CORP LTD (AAACB1111B.XX000)",
        sourceName: "EXAMPLE POWER CORP LTD",
        sourceId: "AAACB1111B.XX000",
        count: 1,
        amount: 5000,
        transactions: [{ date: "2026-05-05", amount: 5000, tdsDeducted: null, status: "Active", raw: expect.any(Object) }],
      },
    ]);
  });

  it("merges a source's transactions across a page break instead of duplicating the entry, when the summary header/row repeats identically", () => {
    const page1 = tdsTcsSalaryRows(0);
    // Page 2 restates the same 5-column header + the SAME summary row (a
    // real AIS-PDF page-break behavior), followed by more transactions for
    // the same source.
    const page2 = [
      row(100, [
        ["SR. NO. INFORMATION CODE", 15, 114],
        ["INFORMATION DESCRIPTION", 253, 105],
        ["INFORMATION SOURCE", 462, 85],
        ["COUNT", 795, 26],
        ["AMOUNT", 901, 33],
      ]),
      row(101, [
        ["1", 15],
        ["TDS-192", 54],
        ["Salary received (Section 192)", 253],
        ["FIRST BROKERAGE LIMITED (MUMA00001A)", 462],
        ["13", 812],
        ["12,34,567", 893],
      ]),
      row(102, [
        ["SR. NO. QUARTER", 15, 74],
        ["DATE OF PAYMENT/CREDIT", 238, 99],
        ["AMOUNT PAID/CREDITED", 435, 92],
        ["TDS DEDUCTED", 619, 57],
        ["TDS DEPOSITED STATUS", 766, 96],
      ]),
      row(103, [
        ["3", 15],
        ["Q3(Oct-Dec)", 54],
        ["31/12/2025", 238],
        ["11,46,664", 492],
        ["3,64,905", 645],
        ["3,64,905 Active", 794],
      ]),
    ];

    const result = parseAisSourceDetail([...page1, ...page2]);

    expect(result.tdsTcs).toHaveLength(1);
    expect(result.tdsTcs[0].transactions).toHaveLength(3);
    expect(result.tdsTcs[0].transactions[2]).toMatchObject({ date: "2025-12-31", amount: 1146664, tdsDeducted: 364905 });
  });

  it("reconstructs a category description AND a source name that both wrap onto the same continuation row, then still finds the real detail header after it", () => {
    // Reduced repro of the real "Interest other than 'Interest on
    // Securities' received (Section 194A)" / "... COMMISSIONER EXAMPLE EAST
    // (MUMD00004D)" block: the summary data row's two long text columns
    // both wrap, landing as TWO cells on ONE continuation row (one per
    // wrapped column) — before this fix, that row (only 2 cells) was
    // mistaken for the detail header itself, corrupting everything after it.
    const rows = [
      row(0, [["Part B1-Information relating to tax deducted or collected at source", 10, 326]]),
      row(1, [["Interest", 10, 40]]),
      row(2, [
        ["SR. NO. INFORMATION CODE", 15, 114],
        ["INFORMATION DESCRIPTION", 253, 105],
        ["INFORMATION SOURCE", 462, 85],
        ["COUNT", 795, 26],
        ["AMOUNT", 901, 33],
      ]),
      row(3, [
        ["12", 15],
        ["TDS-194A", 54],
        ['Interest other than "Interest on Securities" received', 253],
        ["OFFICE OF REGIONAL PROVIDENT FUND COMMISSIONER EXAMPLE", 462],
        ["1", 816],
        ["1,39,440", 904],
      ]),
      row(4, [
        ["(Section 194A)", 253],
        ["EAST (MUMD00004D)", 462],
      ]),
      row(5, [
        ["SR. NO. QUARTER", 15, 74],
        ["DATE OF PAYMENT/CREDIT", 238, 99],
        ["AMOUNT PAID/CREDITED", 435, 92],
        ["TDS DEDUCTED", 619, 57],
        ["TDS DEPOSITED STATUS", 766, 96],
      ]),
      row(6, [
        ["1", 15],
        ["Q1(Apr-Jun)", 54],
        ["21/06/2025", 238],
        ["1,39,440", 496],
        ["13,944", 651],
        ["13,944 Active", 800],
      ]),
    ];

    const result = parseAisSourceDetail(rows);

    expect(result.tdsTcs).toEqual([
      {
        code: "TDS-194A",
        category: 'Interest other than "Interest on Securities" received (Section 194A)',
        source: "OFFICE OF REGIONAL PROVIDENT FUND COMMISSIONER EXAMPLE EAST (MUMD00004D)",
        sourceName: "OFFICE OF REGIONAL PROVIDENT FUND COMMISSIONER EXAMPLE EAST",
        sourceId: "MUMD00004D",
        count: 1,
        amount: 139440,
        transactions: [{ date: "2025-06-21", amount: 139440, tdsDeducted: 13944, status: "Active", raw: expect.any(Object) }],
      },
    ]);
  });

  it("warns when no per-source table is found at all", () => {
    const result = parseAisSourceDetail([row(0, [["Something else", 10]])]);
    expect(result.tdsTcs).toEqual([]);
    expect(result.sft).toEqual([]);
    expect(result.warnings.some((w) => w.includes("No per-source"))).toBe(true);
  });
});
