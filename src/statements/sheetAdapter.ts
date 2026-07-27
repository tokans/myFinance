import type { SheetRaw } from "@/excel/types";
import type { PdfTableRow } from "./types";

/**
 * Adapts spreadsheet rows into the same `PdfTableRow` shape the PDF pipeline
 * produces, so the exact same column-detection/alignment/transaction-parsing
 * code (`columnDetect.ts`, `pdfStatementImport.ts`'s `parseTransactions`) works
 * unchanged for a downloaded bank-statement `.xlsx`/`.xls` (transaction-table
 * shaped, unlike myFinance's own "item | value per month" workbook format).
 * Each spreadsheet column already IS a distinct column — no x-position
 * ambiguity — so cells just get evenly-spaced synthetic x slots wide enough
 * apart that the existing gap-based column-snapping never merges two columns.
 */
export function sheetToTableRows(sheet: SheetRaw, pageIndex: number): PdfTableRow[] {
  return sheet.rows.map((row, rowIndex) => ({
    page_index: pageIndex,
    row_index: rowIndex,
    cells: row
      .map((cell, colIndex) => ({
        text: cell == null ? "" : String(cell),
        x: colIndex * 100,
        width: 90,
      }))
      .filter((c) => c.text.trim() !== ""),
  }));
}

export function sheetsToTableRows(sheets: SheetRaw[]): PdfTableRow[] {
  return sheets.flatMap((sheet, i) => sheetToTableRows(sheet, i));
}
