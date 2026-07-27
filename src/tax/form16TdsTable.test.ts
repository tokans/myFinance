import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { FORM16_DOC_OPTIONS } from "./form16";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

import { parseForm16QuarterTable } from "./form16TdsTable";
import type { PdfTableRow } from "@/statements/types";

/** A row with one already-merged cell — this is what real Form 16 PDFs
 *  actually produce (see module doc comment): the shared geometric
 *  column-banding heuristic collapses these rows into a single blob, so this
 *  parser works on the row's full text instead of individual cells. */
function blobRow(rowIndex: number, text: string, x = 40): PdfTableRow {
  return { page_index: 0, row_index: rowIndex, cells: [{ text, x, width: 500 }] };
}

/** The row fixtures are real Form 16 layouts; only the seam changed. */
function modelOf(rows: PdfTableRow[]) {
  return buildDocModel(
    { doc: fromNativeRows(rows), filename: "form16.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate, ...FORM16_DOC_OPTIONS },
  );
}

describe("parseForm16QuarterTable", () => {
  it("parses quarterly rows from a real Form 16's merged-cell text shape", () => {
    const rows = [
      blobRow(0, "Quarter(s) Amount paid/credited (Rs.)"),
      blobRow(1, "Q1 QWABTHTA 6119998.00 2175485.00 2175485.00"),
      blobRow(2, "Q2 QWCEYGND 3439992.00 1094683.00 1094683.00"),
      blobRow(3, "Q3 QWEXOCTC 3439992.00 1094715.00 1094715.00"),
      blobRow(4, "Q4 QWGGCLIB 3690822.00 1094550.00 1094550.00"),
      blobRow(5, "Total (Rs.) 1234567.00 234567.00 234567.00"),
    ];

    const quarters = parseForm16QuarterTable(modelOf(rows));

    expect(quarters).toHaveLength(4);
    expect(quarters[0]).toEqual({ quarter: "Q1", amountPaid: 6119998, taxDeducted: 2175485, taxDeposited: 2175485 });
    expect(quarters[3]).toEqual({ quarter: "Q4", amountPaid: 3690822, taxDeducted: 1094550, taxDeposited: 1094550 });
    // The header and "Total" rows don't match the quarterly-row shape, so
    // neither is mistaken for a quarter; both stay visible in the model.
    expect(quarters.map((q) => q.quarter)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(quarters.some((q) => q.amountPaid === 1234567)).toBe(false);
  });

  it("still works if cells arrive separately rather than pre-merged", () => {
    const rows: PdfTableRow[] = [
      {
        page_index: 0,
        row_index: 0,
        cells: [
          { text: "Q1", x: 55, width: 15 },
          { text: "QWABTHTA", x: 100, width: 60 },
          { text: "6119998.00", x: 250, width: 60 },
          { text: "2175485.00", x: 350, width: 60 },
          { text: "2175485.00", x: 450, width: 60 },
        ],
      },
    ];

    const quarters = parseForm16QuarterTable(modelOf(rows));

    expect(quarters).toEqual([{ quarter: "Q1", amountPaid: 6119998, taxDeducted: 2175485, taxDeposited: 2175485 }]);
  });

  it("dedupes a quarter restated elsewhere in the document", () => {
    const rows = [
      blobRow(0, "Q1 QWABTHTA 6119998.00 2175485.00 2175485.00"),
      blobRow(1, "Q1 QWABTHTA 6119998.00 2175485.00 2175485.00"), // e.g. a cross-check section restating Q1
    ];

    const quarters = parseForm16QuarterTable(modelOf(rows));

    expect(quarters).toHaveLength(1);
    // Both rows matched the quarterly shape (so both are "claimed"/understood),
    // even though only the first reading is kept in `quarters`.
  });

  it("finds nothing in unrelated text", () => {
    const rows = [blobRow(0, "Something else entirely")];
    const quarters = parseForm16QuarterTable(modelOf(rows));
    expect(quarters).toEqual([]);
  });
});
