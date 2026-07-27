/**
 * Imports a broker/depositor Capital Gains Statement (PDF, password-protected
 * ZIP, or xlsx/xls) — the most divergent document shape this app parses: some
 * brokers present the short/long-term totals as label:value prose lines with
 * NO header row at all ("Short Term Capital Gains ... 1,25,000.00"), others a
 * clean category/amount table. This stays its own scan (not a reuse of
 * `categoryAmountPdf.ts`) for that reason, with `categoryAmountPdf.ts` kept
 * only as a belt-and-suspenders fallback for the table-shaped case.
 *
 * The scan reads the structured document rather than positional rows: a
 * headerless label:value region is a key/value block by the time it gets
 * here, and a table is a table, so the same scan covers both shapes without
 * caring which one the broker chose.
 *
 * Phase 1 (this module): short-term and long-term TOTALS only — same
 * conservative posture as Form16 (quarterly TDS total only) and 26AS/AIS
 * (category totals only). Deliberately NOT built yet, and requiring a new
 * per-transaction table this schema doesn't have: per-scrip/per-transaction
 * capture (ISIN, quantity, buy/sell dates, gain per trade) and cross-checking
 * those against AIS/TIS records to mark/reconcile transactions — a
 * materially bigger parsing surface, deferred to a later phase.
 *
 * `CAPITAL_GAINS_TEMPLATES` is an architecture-only seed (empty for now, no
 * broker template can be verified against a real sample yet) mirroring
 * `statements/institutionTemplates.ts` — a template's own pattern is tried
 * first per field, falling through to the generic label-prose scan below for
 * anything it doesn't cover, so an empty/wrong template can never do worse
 * than the generic scan alone.
 */
import { rowCells, textLines, type DocModel } from "@scandoc/core/docmodel";
import type { TaxIncomeRow } from "@/db/tax";
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog, type ParseLogEntry } from "@/lib/parseLog";
import { parseAmount } from "@/statements/amount";
import { openDocument, type DocModelOverrides } from "@/statements/documentIntake";
import { CATEGORY_AMOUNT_DOC_OPTIONS, parseCategoryAmountDoc } from "./categoryAmountPdf";

/**
 * Deliberately the SAME options the category/amount parser uses, because the
 * fallback below hands it this very model — structuring the document one way
 * for the prose scan and another way for the fallback would make the two
 * disagree about what the document contains. Nothing is lost for the prose
 * scan either way: a row those options set aside is parked in the record's
 * `unmatched`, which `rowCells` still reports.
 */
export const CAPITAL_GAINS_DOC_OPTIONS: DocModelOverrides = CATEGORY_AMOUNT_DOC_OPTIONS;

export interface CapitalGainsTemplate {
  institution: string;
  /** Tested against each row's full joined cell text; capture group 1 = the amount. */
  shortTermPattern?: RegExp;
  longTermPattern?: RegExp;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const CAPITAL_GAINS_TEMPLATES: CapitalGainsTemplate[] = [];

export function capitalGainsTemplateFor(institution?: string | null): CapitalGainsTemplate | null {
  if (!institution) return null;
  return CAPITAL_GAINS_TEMPLATES.find((t) => t.institution === institution) ?? null;
}

const SHORT_TERM_WORD = /\bshort[\s-]?term\b/i;
const LONG_TERM_WORD = /\blong[\s-]?term\b/i;
const CAPITAL_GAIN_WORD = /\bcapital\s*gains?\b/i;
const TOTAL_WORD = /\btotal\b/i;
const TRAILING_AMOUNT = /([\d,]+(?:\.\d+)?)\s*$/;

function isShortTermLabel(text: string): boolean {
  return SHORT_TERM_WORD.test(text) && CAPITAL_GAIN_WORD.test(text);
}
function isLongTermLabel(text: string): boolean {
  return LONG_TERM_WORD.test(text) && CAPITAL_GAIN_WORD.test(text);
}

/** Tries a template's own regex against every row's full joined text. Only
 *  row-level granularity is available here — the match is against the whole
 *  row's text, not a single cell. */
function tryTemplatePattern(lines: string[], pattern?: RegExp): number | null {
  if (!pattern) return null;
  for (const text of lines) {
    const m = pattern.exec(text);
    const amount = m?.[1] ? parseAmount(m[1]) : null;
    if (amount != null) return amount;
  }
  return null;
}

/**
 * Generic label-prose scan: finds a cell whose own text names the given term
 * ("short term" / "long term" + "capital gain(s)"), then the amount from
 * either a trailing number in that SAME cell (a glued "Short Term Capital
 * Gains 1,25,000.00") or the nearest other cell in the same row that parses
 * as an amount (a separate label/value column — the common case for both
 * PDF two-column layouts and spreadsheet-sourced rows, since each is already
 * its own cell). A cell that also says "total" wins outright over a bare
 * label (preferring an explicit summary line over a per-scrip row that
 * happens to repeat the same wording).
 *
 * Reads the document's rows as cells rather than as one joined string per
 * row, because the label and its amount being separate cells is precisely
 * what the second branch depends on.
 */
function extractTotal(rows: string[][], isLabel: (text: string) => boolean): number | null {
  let bestNonTotal: number | null = null;
  for (const cells of rows) {
    for (let i = 0; i < cells.length; i++) {
      const cellText = cells[i];
      if (!isLabel(cellText)) continue;

      const trailing = TRAILING_AMOUNT.exec(cellText);
      let amount = trailing ? parseAmount(trailing[1]) : null;
      if (amount == null) {
        for (let j = 0; j < cells.length; j++) {
          if (j === i) continue;
          const v = parseAmount(cells[j]);
          if (v != null) { amount = v; break; }
        }
      }
      if (amount == null) continue;

      if (TOTAL_WORD.test(cellText)) return amount;
      if (bestNonTotal == null) bestNonTotal = amount;
    }
  }
  return bestNonTotal;
}

export interface CapitalGainsParseResult {
  shortTerm: number | null;
  longTerm: number | null;
  warnings: string[];
  /** The structured document, always shown for reference — this module only
   *  extracts two totals, so the source detail (per-scrip rows, dates, ISINs)
   *  stays visible for manual verification. */
  model: DocModel;
}

export function parseCapitalGainsStatement(
  model: DocModel,
  institution?: string | null,
): CapitalGainsParseResult {
  const warnings: string[] = [];
  const template = capitalGainsTemplateFor(institution);
  const cells = rowCells(model);

  let shortTerm = tryTemplatePattern(textLines(model), template?.shortTermPattern);
  let longTerm = tryTemplatePattern(textLines(model), template?.longTermPattern);

  if (shortTerm == null) shortTerm = extractTotal(cells, isShortTermLabel);
  if (longTerm == null) longTerm = extractTotal(cells, isLongTermLabel);

  // Belt-and-suspenders: some statements present a clean category/amount
  // table instead of label:value prose — try that shape only if the scan
  // above found nothing at all.
  if (shortTerm == null && longTerm == null) {
    const { rows: catRows } = parseCategoryAmountDoc(model);
    for (const r of catRows) {
      if (shortTerm == null && isShortTermLabel(r.category)) shortTerm = r.amount;
      if (longTerm == null && isLongTermLabel(r.category)) longTerm = r.amount;
    }
  }

  if (shortTerm == null) warnings.push("Couldn't find a short-term capital gains total — enter it manually below, or check the parsed document.");
  if (longTerm == null) warnings.push("Couldn't find a long-term capital gains total — enter it manually below, or check the parsed document.");

  return { shortTerm, longTerm, warnings, model };
}

export interface CapitalGainsPreview {
  result: CapitalGainsParseResult;
  passwordUsed: string | null;
  log: ParseLogEntry[];
}

export async function previewCapitalGainsStatement(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
  institution?: string | null,
): Promise<CapitalGainsPreview> {
  const log = createParseLog();
  const opened = await openDocument(bytes, filename, passwordCandidates, log, CAPITAL_GAINS_DOC_OPTIONS);
  const result = parseCapitalGainsStatement(opened.model, institution);
  void writeDebugDump("capital-gains", {
    filename,
    passwordUsed: opened.passwordUsed,
    model: opened.model,
    positional: opened.positional,
    result: { shortTerm: result.shortTerm, longTerm: result.longTerm, warnings: result.warnings },
    log: opened.log,
  });
  return { result, passwordUsed: opened.passwordUsed, log: opened.log };
}

/** Maps the parsed totals onto income rows — only for whichever total was
 *  actually found and > 0, same conservative posture as every other import
 *  in this module ("faithful transcription", not a judgment call). */
export function capitalGainsPdfToIncomeRows(result: CapitalGainsParseResult, ay: string): Omit<TaxIncomeRow, "id">[] {
  const rows: Omit<TaxIncomeRow, "id">[] = [];
  if (result.shortTerm != null && result.shortTerm > 0) {
    rows.push({
      ay,
      head: "cg_short",
      label: "Short-term capital gains (from statement)",
      amount: result.shortTerm,
      source_path: "CapitalGains-PDF",
      note: "From a broker capital gains statement — review before relying on this.",
      excluded: false,
    });
  }
  if (result.longTerm != null && result.longTerm > 0) {
    rows.push({
      ay,
      head: "cg_long",
      label: "Long-term capital gains (from statement)",
      amount: result.longTerm,
      source_path: "CapitalGains-PDF",
      note: "From a broker capital gains statement — review before relying on this.",
      excluded: false,
    });
  }
  return rows;
}
