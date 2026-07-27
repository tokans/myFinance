/**
 * Imports the TIS (Taxpayer Information Summary) PDF export from the
 * compliance portal — the AIS's "processed value" counterpart. Same table
 * shape and password convention as `aisPdf.ts`; kept as a separate module
 * (rather than one flag) since it's a distinct download the user picks by name.
 */
import type { DocModel } from "@scandoc/core/docmodel";
import type { TaxIncomeRow, TaxPaymentRow } from "@/db/tax";
import type { TaxRefundRow } from "@/db/taxRefunds";
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog, type ParseLogEntry } from "@/lib/parseLog";
import { openDocument } from "@/statements/documentIntake";
import { CATEGORY_AMOUNT_DOC_OPTIONS, parseCategoryAmountDoc, type CategoryAmountParseResult } from "./categoryAmountPdf";

export type TisPdfParseResult = CategoryAmountParseResult;

export interface TisPdfPreview {
  result: TisPdfParseResult;
  /** The structured document, for the review screen's "Parsed document" panel. */
  model: DocModel;
  passwordUsed: string | null;
  log: ParseLogEntry[];
}

export async function previewTisPdf(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
): Promise<TisPdfPreview> {
  const log = createParseLog();
  const opened = await openDocument(bytes, filename, passwordCandidates, log, CATEGORY_AMOUNT_DOC_OPTIONS);
  const result = parseCategoryAmountDoc(opened.model);
  const missingCategory = result.rows.filter((r) => !r.category.trim()).length;
  if (missingCategory > 0) {
    log.log(
      "Categories",
      `${missingCategory} row(s) had no category recognized — they'll show as "(uncategorized)"; check the parsed document below.`,
    );
  }
  void writeDebugDump("tis-pdf", { filename, passwordUsed: opened.passwordUsed, model: opened.model, positional: opened.positional, result, log: opened.log });
  return { result, model: opened.model, passwordUsed: opened.passwordUsed, log: opened.log };
}

/** Maps parsed TIS-PDF categories onto income rows, flagged for review same as AIS-PDF. */
export function tisPdfToIncomeRows(result: TisPdfParseResult, ay: string): Omit<TaxIncomeRow, "id">[] {
  return result.rows
    .filter((r) => r.amount !== null && r.amount > 0)
    .map((r) => ({
      ay,
      head: /dividend/i.test(r.category) ? ("dividend" as const) : ("other_sources" as const),
      label: r.category || "(uncategorized)",
      amount: r.amount ?? 0,
      source_path: "TIS-PDF",
      note: "From TIS PDF summary — review category/head before relying on this.",
      excluded: false,
    }));
}

/** Maps TIS-PDF Part B3 advance-tax challans onto tax payment rows — present
 *  only if this particular TIS export includes that section (unverified
 *  against a real sample; TIS is typically a simplified summary and may not
 *  carry it, in which case `paymentRows` is simply empty). */
export function tisPdfToPaymentRows(result: TisPdfParseResult, ay: string): Omit<TaxPaymentRow, "id">[] {
  return result.paymentRows.map((r) => ({
    ay,
    type: "advance" as const,
    payer_name: null,
    amount: r.amount,
    source_path: "TIS-PDF",
    note: r.date ? `Advance-tax challan deposited ${r.date}, from TIS PDF Part B3.` : "Advance-tax challan from TIS PDF Part B3.",
  }));
}

/** Maps TIS-PDF Part B4 refunds onto refund rows (`myfinance_tax_refunds`) — see `tisPdfToPaymentRows`. */
export function tisPdfToRefundRows(result: TisPdfParseResult, ay: string): Omit<TaxRefundRow, "id">[] {
  return result.refundRows.map((r) => ({
    ay,
    amount: r.amount,
    mode: r.mode,
    refund_date: r.date,
    source_path: "TIS-PDF",
    note: r.nature || "From TIS PDF Part B4.",
  }));
}
