/**
 * Form 16 Part A's quarterly TDS-on-salary table — entirely self-contained,
 * NOT built on the shared geometric column-detection engine
 * (`@/statements/columnSnap`) that Form 26AS/AIS/TIS/bank-statement parsing
 * uses. That engine assumes a clean, evenly-spaced grid (true for a bank
 * statement or 26AS's deductor table) and infers columns from x-position
 * bands. Form 16's real page layout (verified against an actual
 * TRACES-issued certificate) is far denser: long multi-line-wrapped column
 * headers, free-flowing certificate/verification prose, and a legend table
 * all share the same page — and PDFium's per-character extraction, when a
 * page mixes prose with a table, produces text runs that bridge what should
 * be separate table columns into one merged blob (confirmed from a real
 * parse: an entire quarterly data row came back as a single cell, e.g. "Q1
 * QWABTHTA 6119998.00 2175485.00 2175485.00"). Trying to reuse the shared
 * column-banding heuristic here doesn't just fail to fix that — it can
 * silently corrupt column assignment, since the bands it infers are wrong
 * for this page's geometry.
 *
 * Instead, this module works directly on each row's full joined text (however
 * PDFium/table-reconstruction happened to split or merge its cells) using a
 * regex pattern anchored to Form 16 Part A's known, standardized shape:
 * quarter rows always read "Q<n> <receipt-no> <amount> <amount> <amount>".
 * This is robust to exactly the kind of cell-merging seen above, since it
 * doesn't depend on column x-positions or cell boundaries at all.
 *
 * See `form16.ts` for how this is combined with `form16TaxDeposits.ts` and
 * `form16PartB.ts` (each covering a different, differently-shaped part of
 * the same document) into one comprehensive result.
 */
import { parseAmount } from "@/statements/amount";
import { textLines, type DocModel } from "@scandoc/core/docmodel";

// e.g. "Q1 QWABTHTA 6119998.00 2175485.00 2175485.00" — quarter, receipt
// number (alphanumeric), amount paid/credited, tax deducted, tax deposited.
// Amounts are optionally comma-grouped (Indian numbering) with a decimal part.
const QUARTER_ROW_PATTERN =
  /^(Q[1-4])\s+(\S+)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s*$/i;

export interface Form16QuarterRow {
  quarter: string;
  amountPaid: number | null;
  taxDeducted: number | null;
  taxDeposited: number | null;
}

/** Parses the quarter-indexed TDS table by matching each row's own text
 *  against the known Form 16 Part A quarterly-row shape. Dedupes by quarter
 *  label in case the same figures are restated elsewhere in the document. */
export function parseForm16QuarterTable(model: DocModel): Form16QuarterRow[] {
  const quarters: Form16QuarterRow[] = [];
  const seenQuarters = new Set<string>();

  for (const line of textLines(model)) {
    const m = QUARTER_ROW_PATTERN.exec(line.replace(/\s+/g, " ").trim());
    if (!m) continue;

    const quarter = m[1].toUpperCase();
    if (seenQuarters.has(quarter)) continue; // restated elsewhere — keep the first reading
    seenQuarters.add(quarter);

    quarters.push({
      quarter,
      amountPaid: parseAmount(m[3]),
      taxDeducted: parseAmount(m[4]),
      taxDeposited: parseAmount(m[5]),
    });
  }

  return quarters;
}
