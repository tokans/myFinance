/**
 * Form 26AS's header/metadata (PAN, assessment year) — best-effort, degrading
 * to null rather than guessing, same posture as `form16Header.ts`. Unlike
 * Form 16, there's no real-world 26AS document in this codebase to verify
 * label wording against, so these patterns cover the conventional TRACES
 * labels ("Permanent Account Number (PAN)", "Assessment Year", "Financial
 * Year") plus a bare-PAN fallback; they may need widening once tested
 * against an actual downloaded 26AS.
 *
 * 26AS is issued per Financial Year but the app (and the rest of this
 * document-import pipeline) keys everything by Assessment Year, so a
 * "Financial Year" label is accepted too and converted via `fyToAy`
 * (`aisParser.ts` — "FY 2025-26 → AY 2026-27") when no direct "Assessment
 * Year" label is found.
 */
import { cellByPattern, tables, textLines, type DocModel } from "@scandoc/core/docmodel";
import { fyToAy } from "./aisParser";

const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/;
const ASSESSMENT_YEAR = /assessment\s*year\s*:?\s*(\d{4}-\d{2,4})/i;
const FINANCIAL_YEAR = /financial\s*year\s*:?\s*(\d{4}-\d{2,4})/i;

export interface Form26asHeader {
  pan: string | null;
  assessmentYear: string | null;
}

/** Reads the header block as prose rather than structure: the values sit
 *  wherever the export chose to print them, so scanning every line is more
 *  robust than betting on a particular layout. */
export function extractForm26asHeader(model: DocModel): Form26asHeader {
  let pan: string | null = null;
  let assessmentYear: string | null = null;
  let financialYear: string | null = null;

  // Structured first. 26AS's text export prints its identity block as a real
  // table — labels on one line, values on the next — so the label and its
  // value never share a line and a prose scan can only ever find the bare
  // PAN, never the year beside it. Reading it as a table pairs them.
  for (const table of tables(model)) {
    for (const record of table.records) {
      pan = pan ?? cellByPattern(record, [/permanent account number|\bpan\b/i]);
      assessmentYear = assessmentYear ?? cellByPattern(record, [/assessment\s*year/i]);
      financialYear = financialYear ?? cellByPattern(record, [/financial\s*year/i]);
    }
  }
  if (pan && !PAN_PATTERN.test(pan)) pan = null; // a column named "PAN" holding something else

  for (const text of textLines(model)) {
    if (!pan) pan = PAN_PATTERN.exec(text)?.[0] ?? null;
    if (!assessmentYear) assessmentYear = ASSESSMENT_YEAR.exec(text)?.[1] ?? null;
    if (!financialYear) financialYear = FINANCIAL_YEAR.exec(text)?.[1] ?? null;
  }

  return { pan, assessmentYear: assessmentYear ?? (financialYear ? fyToAy(financialYear) : null) };
}
