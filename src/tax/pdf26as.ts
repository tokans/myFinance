/**
 * Imports a Form 26AS "Annual Tax Statement" document (downloaded from the
 * TRACES / Income-Tax e-filing portal as a PDF, a password-protected ZIP
 * containing either, or — once a taxpayer has more than 1000 transaction
 * entries and the portal stops offering PDF at all — a password-protected
 * ZIP containing a delimited "Text" export; conventionally password-protected
 * with the filer's PAN + date of birth). Reuses the shared document intake
 * (`@/statements/documentIntake`, handling PDF/ZIP/xlsx/xls/txt uniformly)
 * and, for the PDF/xlsx path, the deductor-per-row TDS-table parser
 * (`tdsTablePdf.ts` — NOT shared with Form 16, which has a different,
 * quarter-indexed table shape; see `form16TdsTable.ts`); the text path has
 * its own parser (`form26asText.ts`) but produces the identical `TdsRow`
 * shape, so everything downstream of `previewForm26as` is format-agnostic.
 * Scoped to Part A (TDS on income other than salary) — maps onto the same
 * `tds_other` payment rows AIS import writes, and (via
 * `form26asToIncomeRows`) the same `other_sources` income head AIS/TIS-PDF
 * import writes from each row's `amountPaid` (the income the TDS was
 * deducted from).
 */
import type { TaxIncomeRow, TaxPaymentRow } from "@/db/tax";
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog, type ParseLogEntry } from "@/lib/parseLog";
import type { DocModel } from "@scandoc/core/docmodel";
import { openDocument } from "@/statements/documentIntake";
import { extractForm26asHeader, type Form26asHeader } from "./form26asHeader";
import { parseTdsDoc, type TdsTableParseResult } from "./tdsTablePdf";

export type Form26asRow = TdsTableParseResult["rows"][number];
export type Form26asParseResult = TdsTableParseResult;

export interface Form26asPreview {
  result: Form26asParseResult;
  header: Form26asHeader;
  /** The structured document, for the review screen's "Parsed document" panel. */
  model: DocModel;
  passwordUsed: string | null;
  log: ParseLogEntry[];
}

export async function previewForm26as(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
): Promise<Form26asPreview> {
  const log = createParseLog();
  // One path for every format. The caret-delimited "Text" export used to need
  // a parser of its own; it doesn't now, because its leading empty field
  // becomes exactly the indent that nests each deductor's transactions, so
  // the delimited text structures into the same model a PDF does.
  const opened = await openDocument(bytes, filename, passwordCandidates, log);
  const result = parseTdsDoc(opened.model);
  const header = extractForm26asHeader(opened.model);

  const missingDeductor = result.rows.filter((r) => !r.deductorName.trim()).length;
  if (missingDeductor > 0) {
    log.log(
      "Deductor names",
      `${missingDeductor} row(s) had no deductor name recognized — they'll show as "(unknown deductor)"; check the parsed document below.`,
    );
  }

  void writeDebugDump("26as", {
    filename,
    passwordUsed: opened.passwordUsed,
    model: opened.model,
    positional: opened.positional,
    result,
    header,
    log: opened.log,
  });
  return { result, header, model: opened.model, passwordUsed: opened.passwordUsed, log: opened.log };
}

/** Section 194 is Dividend TDS (confirmed against the AIS JSON's own DIV↔194
 *  pairing — see aisParser.ts's classifyIncome test fixtures). Matched exactly
 *  (not a prefix) so 194A (interest other than securities) etc. aren't swept in. */
function isDividendRow(row: Form26asRow): boolean {
  return row.transactions.some((t) => t.section === "194");
}

/** Maps parsed 26AS rows onto the same `tds_other` payment shape AIS import writes. */
export function form26asToPaymentRows(result: Form26asParseResult, ay: string): Omit<TaxPaymentRow, "id">[] {
  return result.rows
    .filter((r) => r.taxDeducted !== null && r.taxDeducted > 0)
    .map((r) => ({
      ay,
      type: "tds_other" as const,
      payer_name: r.deductorName || null,
      amount: r.taxDeducted ?? 0,
      source_path: "26AS-PDF",
      note: r.tan ? `TAN ${r.tan}` : null,
    }));
}

/** Maps each deductor's `amountPaid` onto an `other_sources` income row —
 *  the amount that TDS was deducted from (e.g. bank interest credited). This
 *  is a blunt figure (26AS doesn't say whether it's fully taxable, and it can
 *  genuinely overlap with an AIS/TIS import of the same source for the same
 *  AY), so it's flagged for review rather than silently trusted, same as
 *  AIS-PDF/TIS-PDF's own income rows. */
export function form26asToIncomeRows(result: Form26asParseResult, ay: string): Omit<TaxIncomeRow, "id">[] {
  return result.rows
    .filter((r) => r.amountPaid !== null && r.amountPaid > 0)
    .map((r) => ({
      ay,
      head: isDividendRow(r) ? ("dividend" as const) : ("other_sources" as const),
      label: r.deductorName || "(unknown deductor)",
      amount: r.amountPaid ?? 0,
      source_path: "26AS-PDF",
      note: "From Form 26AS — the amount this deductor paid/credited, on which tax was deducted. May overlap with AIS/TIS income for the same source; review before combining.",
      excluded: false,
    }));
}
