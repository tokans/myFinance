/**
 * Form 16 Part A's "Details of tax deducted and deposited in the Central
 * Government account" tables (book-adjustment / BIN, and challan / CIN) — a
 * per-payment ledger of every TDS deposit the deductor made during the year.
 * Same self-contained, text-pattern approach as `form16TdsTable.ts`: each row
 * reads "<Sl.No> <amount> <BSR/book code> <dd-mm-yyyy> <serial no.> <status
 * letter>" regardless of how the shared column-reconstruction happened to
 * split or merge that row's cells.
 */
import { parseAmount } from "@/statements/amount";
import { textLines, type DocModel } from "@scandoc/core/docmodel";

const DEPOSIT_ROW_PATTERN =
  /^(\d{1,3})\s+([\d,]+(?:\.\d{1,2})?)\s+(\S+)\s+(\d{2}-\d{2}-\d{4})\s+(\S+)\s+([A-Z])\s*$/;

export interface Form16TaxDepositRow {
  slNo: number;
  amount: number | null;
  /** BSR code (challan deposits) or book-identification code (book-adjustment deposits). */
  code: string;
  date: string;
  /** Challan serial number, or DDO serial number in Form 24G for book-adjustment deposits. */
  serialNo: string;
  /** OLTAS matching status: F(inal)/P(rovisional)/U(nmatched)/O(verbooked). */
  status: string;
}

/** Parses every tax-deposit row found in the document. */
export function parseForm16TaxDeposits(model: DocModel): Form16TaxDepositRow[] {
  const deposits: Form16TaxDepositRow[] = [];

  for (const line of textLines(model)) {
    const m = DEPOSIT_ROW_PATTERN.exec(line.replace(/\s+/g, " ").trim());
    if (!m) continue;

    deposits.push({
      slNo: parseInt(m[1], 10),
      amount: parseAmount(m[2]),
      code: m[3],
      date: m[4],
      serialNo: m[5],
      status: m[6],
    });
  }

  return deposits;
}
