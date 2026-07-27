/**
 * Imports the AIS (Annual Information Statement) PDF export from the
 * compliance portal — distinct from the AIS *Utility's* encrypted-JSON export
 * already handled by `aisCrypto.ts`/`aisParser.ts`. The PDF is a per-category
 * summary table (lighter/less precise than the structured JSON) and is
 * conventionally password-protected with PAN + date of birth, same as the
 * JSON. See `categoryAmountPdf.ts` for the shared table shape (also used by
 * `tisPdf.ts`), and `aisSourceDetailPdf.ts` for the richer per-SOURCE
 * structure (payer name, per-transaction date/amount/TDS/status) this module
 * uses for payments (payer-tagged, for recon) and the SFT cross-check table —
 * `result.rows` stays the flat, user-editable category+amount review surface
 * for income (unchanged shape, so existing review-and-edit UX still works).
 */
import type { DocModel } from "@scandoc/core/docmodel";
import type { TaxIncomeRow, TaxPaymentRow, IncomeHead, PaymentType } from "@/db/tax";
import type { TaxRefundRow } from "@/db/taxRefunds";
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog, type ParseLogEntry } from "@/lib/parseLog";
import { modelFromTableRows, openProtectedDocument, tableRowsFrom } from "@/statements/documentIntake";
import { CATEGORY_AMOUNT_DOC_OPTIONS, parseCategoryAmountDoc, type CategoryAmountParseResult } from "./categoryAmountPdf";
import { parseAisSourceDetail, type AisSourceDetailResult } from "./aisSourceDetailPdf";

export interface AisPdfParseResult extends CategoryAmountParseResult {
  /** Per-source detail (payer name, per-transaction date/amount/TDS/status),
   *  structurally separate from the flat `rows` above — see
   *  `aisSourceDetailPdf.ts`. Used for TDS/TCS payment rows and the SFT
   *  cross-check table, not shown in the editable review YAML. */
  sourceDetail: AisSourceDetailResult;
}

export interface AisPdfPreview {
  result: AisPdfParseResult;
  /** The structured document, for the review screen's "Parsed document" panel. */
  model: DocModel;
  passwordUsed: string | null;
  log: ParseLogEntry[];
}

export async function previewAisPdf(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
): Promise<AisPdfPreview> {
  const log = createParseLog();
  const opened = await openProtectedDocument(bytes, filename, passwordCandidates, log);
  const rows = tableRowsFrom(opened, filename);
  // Half-migrated by design: the category summary reads the structured model,
  // while the per-source detail below is still a geometry parser. Both are
  // built from the SAME extraction so they can never disagree about the
  // document. Collapses to a single `openDocument` call once
  // `aisSourceDetailPdf.ts` is migrated too.
  const model = modelFromTableRows(rows, filename, CATEGORY_AMOUNT_DOC_OPTIONS);
  const flat = parseCategoryAmountDoc(model);
  const sourceDetail = parseAisSourceDetail(rows);
  const result: AisPdfParseResult = { ...flat, sourceDetail };
  const missingCategory = result.rows.filter((r) => !r.category.trim()).length;
  if (missingCategory > 0) {
    log.log(
      "Categories",
      `${missingCategory} row(s) had no category recognized — they'll show as "(uncategorized)"; check the parsed document below.`,
    );
  }
  void writeDebugDump("ais-pdf", { filename, passwordUsed: opened.passwordUsed, model, rows, result, log: opened.log });
  return { result, model, passwordUsed: opened.passwordUsed, log: opened.log };
}

/** Text-based income-head classification for a category label, e.g. "Salary
 *  received (Section 192)" or "Dividend income (SFT-015)" — mirrors
 *  `aisParser.ts`'s `classifyIncome` (the JSON path), minus its code-based
 *  branch (the flat `{category, amount}` rows here don't carry AIS's
 *  category code). Previously this only distinguished dividend from
 *  "everything else → other_sources", which silently mis-bucketed salary. */
function classifyHead(category: string): IncomeHead {
  const s = category.toLowerCase();
  if (/salary|pension/.test(s)) return "salary";
  if (/dividend/.test(s)) return "dividend";
  if (/business|professional|receipts/.test(s)) return "business";
  if (/rent|house\s*prop/.test(s)) return "house_property";
  return "other_sources";
}

/** Maps parsed AIS-PDF categories onto income rows, flagged for review same as AIS-JSON import. */
export function aisPdfToIncomeRows(result: AisPdfParseResult, ay: string): Omit<TaxIncomeRow, "id">[] {
  return result.rows
    .filter((r) => r.amount !== null && r.amount > 0)
    .map((r) => ({
      ay,
      head: classifyHead(r.category),
      label: r.category || "(uncategorized)",
      amount: r.amount ?? 0,
      source_path: "AIS-PDF",
      note: "From AIS PDF summary — review category/head before relying on this.",
      excluded: false,
    }));
}

/** Maps AIS-PDF Part B3 advance-tax challans AND Part B1's per-source TDS/TCS
 *  detail (`sourceDetail.tdsTcs`) onto tax payment rows — the latter carries
 *  a payer name (for `domain/recon.ts`'s entity-matching against Form16/
 *  26AS) and sums each source's per-transaction TDS/TCS deducted, counting
 *  only "Active" transactions (AIS keeps superseded/corrected transactions
 *  in the same list; only Active ones should count — same guard as
 *  `aisParser.ts`'s JSON-path equivalent, verified to match the deductor
 *  totals on a real document). Previously this only had the B3 challans —
 *  TDS/TCS withheld by a deductor was silently absent from the PDF path
 *  entirely (present on the JSON path). */
export function aisPdfToPaymentRows(result: AisPdfParseResult, ay: string): Omit<TaxPaymentRow, "id">[] {
  const challanRows: Omit<TaxPaymentRow, "id">[] = result.paymentRows.map((r) => ({
    ay,
    type: "advance" as const,
    payer_name: null,
    amount: r.amount,
    source_path: "AIS-PDF",
    note: r.date ? `Advance-tax challan deposited ${r.date}, from AIS PDF Part B3.` : "Advance-tax challan from AIS PDF Part B3.",
  }));

  const byPayer = new Map<string, { type: PaymentType; payer: string | null; amount: number }>();
  for (const entry of result.sourceDetail.tdsTcs) {
    const tds = entry.transactions
      .filter((t) => t.status !== "Inactive")
      .reduce((sum, t) => sum + (t.tdsDeducted ?? 0), 0);
    if (tds <= 0) continue;
    const type: PaymentType = /salary/i.test(entry.category) ? "tds_salary" : "tds_other";
    const key = `${type} ${entry.sourceName ?? ""}`;
    const prev = byPayer.get(key);
    if (prev) prev.amount += tds;
    else byPayer.set(key, { type, payer: entry.sourceName, amount: tds });
  }
  const tdsTcsRows: Omit<TaxPaymentRow, "id">[] = Array.from(byPayer.values()).map((p) => ({
    ay,
    type: p.type,
    payer_name: p.payer,
    amount: p.amount,
    source_path: "AIS-PDF",
    note: "TDS/TCS withheld, from AIS PDF Part B1 (per-source detail).",
  }));

  return [...challanRows, ...tdsTcsRows];
}

/** Maps AIS-PDF Part B4 refunds onto refund rows (`myfinance_tax_refunds`). */
export function aisPdfToRefundRows(result: AisPdfParseResult, ay: string): Omit<TaxRefundRow, "id">[] {
  return result.refundRows.map((r) => ({
    ay,
    amount: r.amount,
    mode: r.mode,
    refund_date: r.date,
    source_path: "AIS-PDF",
    note: r.nature || "From AIS PDF Part B4.",
  }));
}

/** One SFT (Statement of Financial Transaction) row, shaped for
 *  `db/aisSft.ts`'s `replaceSftForAy` — matches `aisParser.ts`'s
 *  `AisSftRow` (the JSON path's equivalent) exactly, so AIS-PDF import
 *  populates the SAME cross-check table (`domain/sftCrossCheck.ts`) the
 *  JSON import already feeds. Never folded into income — see the module
 *  doc comment / `categoryAmountPdf.ts`'s SFT exclusion for why summing
 *  both would double-count. */
export interface AisPdfSftRow {
  sftCode: string;
  description: string;
  reportingEntity: string | null;
  amount: number;
  date: string | null;
}

/** Maps AIS-PDF Part B2 (SFT) source entries onto SFT cross-check rows. */
export function aisPdfToSftRows(result: AisPdfParseResult): AisPdfSftRow[] {
  return result.sourceDetail.sft
    .filter((e) => e.amount !== null && e.amount > 0)
    .map((e) => ({
      sftCode: e.code,
      description: e.category,
      reportingEntity: e.sourceName,
      amount: e.amount ?? 0,
      // SFT summary rows are FY-level aggregates with no single transaction
      // date, same as the JSON path's AisSftRow — even though this module
      // captures per-transaction dates elsewhere, an SFT source entry can
      // have several (see aisSourceDetailPdf.ts), so there's no single
      // "the" date to put here.
      date: null,
    }));
}
