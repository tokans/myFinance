import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { FORM16_DOC_OPTIONS } from "./form16";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

import { parseForm16TaxDeposits } from "./form16TaxDeposits";
import type { PdfTableRow } from "@/statements/types";

function row(rowIndex: number, text: string): PdfTableRow {
  return { page_index: 0, row_index: rowIndex, cells: [{ text, x: 40, width: 500 }] };
}

/** The row fixtures are real Form 16 layouts; only the seam changed. */
function modelOf(rows: PdfTableRow[]) {
  return buildDocModel(
    { doc: fromNativeRows(rows), filename: "form16.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate, ...FORM16_DOC_OPTIONS },
  );
}

describe("parseForm16TaxDeposits", () => {
  it("parses real Form 16 challan deposit rows regardless of merged cells", () => {
    const rows = [
      row(0, "Sl. No. deductee"),
      row(1, "1 529590.00 6390009 06-05-2025 20180 F"),
      row(2, "2 1281006.00 6390009 06-06-2025 71052 F"),
      row(3, "Total (Rs.) 234567.00"),
    ];

    const deposits = parseForm16TaxDeposits(modelOf(rows));

    expect(deposits).toHaveLength(2);
    expect(deposits[0]).toEqual({ slNo: 1, amount: 529590, code: "6390009", date: "06-05-2025", serialNo: "20180", status: "F" });
    // The "Total" row doesn't match the deposit-row shape and must not become one.
    expect(deposits.some((d) => d.amount === 234567)).toBe(false);
  });

  it("handles a zero-amount row with placeholder dashes", () => {
    const rows = [row(0, "12 0.00 - 27-04-2026 - F")];
    const deposits = parseForm16TaxDeposits(modelOf(rows));
    expect(deposits).toEqual([{ slNo: 12, amount: 0, code: "-", date: "27-04-2026", serialNo: "-", status: "F" }]);
  });

  it("finds nothing in unrelated text", () => {
    const rows = [row(0, "Certificate under Section 203 of the Income-tax Act, 1961")];
    const deposits = parseForm16TaxDeposits(modelOf(rows));
    expect(deposits).toEqual([]);
  });
});
