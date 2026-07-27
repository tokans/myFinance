/**
 * Imports a Form 16 "TDS Certificate" document (issued by an employer, PDF or
 * password-protected ZIP — conventionally password-protected with the
 * employee's PAN + date of birth or employee ID).
 *
 * Unlike the earlier Part-A-only design, this captures the WHOLE document —
 * header metadata, the quarterly TDS table (`form16TdsTable.ts`), the
 * per-challan tax-deposit ledger (`form16TaxDeposits.ts`), and every numbered
 * Part B line item (`form16PartB.ts`) — into one comprehensive, reviewable
 * result. Each of those three sections is parsed independently by its own
 * dedicated module (a different real-world shape each, not a shared engine —
 * see `form16TdsTable.ts`'s doc comment for why), and whatever's still
 * unclaimed across all three (certificate/verification prose, the legend,
 * explanatory notes) is surfaced as a raw table for reference.
 *
 * `form16ToPaymentRows` derives a `tds_salary` payment row from the quarterly
 * TDS total (Part A). `form16PartBMap.ts` layers a semantic reading on top of
 * Part B's generic transcription — Part B's item numbering is CBDT-prescribed
 * and stable, so item 6 ("Income chargeable under the head Salaries") and
 * item 10's lettered Chapter VI-A sub-items are confidently identifiable
 * positionally — and `form16ToIncomeRows`/`form16ToDeductionRows` below turn
 * those into a salary income row and per-section deduction rows. Anything
 * `form16PartBMap.ts` can't confidently match (a missing item, an
 * unrecognized Chapter VI-A section) is surfaced as a warning rather than
 * guessed, and stays visible only in the raw Part B data for manual entry —
 * same conservative posture as everywhere else in this pipeline.
 */
import type { TaxPaymentRow } from "@/db/tax";
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog, type ParseLogEntry } from "@/lib/parseLog";
import type { DocModel } from "@scandoc/core/docmodel";
import { openDocument, type DocModelOverrides } from "@/statements/documentIntake";
import { extractForm16Header, type Form16Header } from "./form16Header";
import { parseForm16PartB, type Form16PartBItem } from "./form16PartB";
import { extractChapterViaDeductions, extractSalaryIncome } from "./form16PartBMap";
import { parseForm16TaxDeposits, type Form16TaxDepositRow } from "./form16TaxDeposits";
import { parseForm16QuarterTable, type Form16QuarterRow } from "./form16TdsTable";

export { form16ToDeductionRows, form16ToIncomeRows } from "./form16PartBMap";

/**
 * Structuring options Form 16 needs beyond the app defaults.
 *
 * Nothing in this certificate is a wrapped continuation of the row above it,
 * so nothing may be folded onto that row. Part B prints a long label AROUND
 * its own marker row rather than after it:
 *
 *     Value of perquisites under section 17(2) (as per Form No. 12BA,
 *     (b)                                                    1,23,456.00
 *     wherever applicable)
 *
 * Folding the middle row onto the first destroys BOTH — the label swallows
 * the item, and the item's marker stops being the start of a line, which is
 * the only thing `form16PartB.ts` can anchor on. On a real certificate that
 * silently cost 23 of 82 line items, entire runs of sub-items (1(a)–1(c),
 * 10(a)–10(h)) at a time. Parking every such row instead keeps each physical
 * row addressable as its own line, which is exactly the view all three Part A
 * and Part B parsers were written against — they scan for fixed, anchored
 * shapes ("Q<n> <receipt> <amount> <amount> <amount>"), not for prose.
 *
 * Exported so the import page and the tests structure the document
 * identically; the two disagreeing is the one failure mode invisible in both.
 */
export const FORM16_DOC_OPTIONS: DocModelOverrides = { continuation: () => "skip" };

export interface Form16ParseResult {
  header: Form16Header;
  quarters: Form16QuarterRow[];
  taxDeposits: Form16TaxDepositRow[];
  partB: Form16PartBItem[];
  warnings: string[];
}

export interface Form16Preview {
  result: Form16ParseResult;
  /** The structured document, for the review screen's "Parsed document" panel —
   *  everything the three section parsers below didn't claim (certificate and
   *  verification prose, the legend, explanatory notes) stays visible there. */
  model: DocModel;
  passwordUsed: string | null;
  log: ParseLogEntry[];
}

/** Two independent tallies of the same deposited TDS, from two
 *  differently-shaped tables in the same document (the quarterly table and
 *  the challan-level deposit ledger) — a mismatch is a strong signal a row
 *  in one of them was missed by the parse. */
export function checkDepositConsistency(quarters: Form16QuarterRow[], deposits: Form16TaxDepositRow[]): string | null {
  const depositLedgerTotal = deposits.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const quarterDepositedTotal = quarters.reduce((sum, q) => sum + (q.taxDeposited ?? 0), 0);
  if (depositLedgerTotal <= 0 || quarterDepositedTotal <= 0) return null;
  if (Math.abs(depositLedgerTotal - quarterDepositedTotal) <= 1) return null;
  return `The quarterly TDS-deposited total (₹${quarterDepositedTotal.toLocaleString("en-IN")}) doesn't match the tax-deposit ledger total (₹${depositLedgerTotal.toLocaleString("en-IN")}) — some deposit rows may not have been recognized; check the raw data below.`;
}

export async function previewForm16(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
): Promise<Form16Preview> {
  const log = createParseLog();
  const opened = await openDocument(bytes, filename, passwordCandidates, log, FORM16_DOC_OPTIONS);

  const header = extractForm16Header(opened.model);
  const quarters = parseForm16QuarterTable(opened.model);
  const deposits = parseForm16TaxDeposits(opened.model);
  const partB = parseForm16PartB(opened.model);

  const warnings: string[] = [];
  if (quarters.length === 0) warnings.push("Couldn't find the quarter-wise TDS table — check this is Form 16 Part A.");
  if (!header.employerName) warnings.push("Employer name wasn't found automatically — please fill it in below.");

  const depositConsistencyWarning = checkDepositConsistency(quarters, deposits);
  if (depositConsistencyWarning) warnings.push(depositConsistencyWarning);

  const salaryIncome = extractSalaryIncome(partB);
  if (salaryIncome.warning) warnings.push(salaryIncome.warning);
  const chapterVia = extractChapterViaDeductions(partB);
  if (chapterVia.warning) warnings.push(chapterVia.warning);

  const result: Form16ParseResult = { header, quarters, taxDeposits: deposits, partB, warnings };

  void writeDebugDump("form16", {
    filename,
    passwordUsed: opened.passwordUsed,
    model: opened.model,
    positional: opened.positional,
    result,
    log: opened.log,
  });

  return { result, model: opened.model, passwordUsed: opened.passwordUsed, log: opened.log };
}

/** Maps the quarterly TDS total (Part A only — see module doc comment) onto
 *  a single `tds_salary` payment row. */
export function form16ToPaymentRows(result: Form16ParseResult, ay: string): Omit<TaxPaymentRow, "id">[] {
  const totalTaxDeducted = result.quarters.reduce((sum, q) => sum + (q.taxDeducted ?? 0), 0);
  if (totalTaxDeducted <= 0) return [];

  return [
    {
      ay,
      type: "tds_salary" as const,
      payer_name: result.header.employerName,
      amount: totalTaxDeducted,
      source_path: "Form16-PDF",
      note: result.header.tan ? `TAN ${result.header.tan}` : null,
    },
  ];
}
