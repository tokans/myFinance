/**
 * Imports a Chartered Accountant's tax computation sheet — a document the
 * user's CA prepares independently of this app, used purely as a check
 * against this app's own computed figures (`tax/caReconciliation.ts`), never
 * to feed tax_income/tax_deductions/tax_payments. Real CA sheets vary format
 * CA-to-CA (different wording, column layouts, section ordering), so unlike
 * AIS/TIS's `categoryAmountPdf.ts` this can't rely on a fixed header-keyword
 * vocabulary. Instead it reads the document STRUCTURALLY: a row with no
 * parseable amount is a section title (nesting decided by its cell's x
 * position vs. the currently open section), a row with an amount is a line
 * item under whichever section is innermost, and numbered "Schedule <name>"
 * blocks get the same treatment — except a schedule whose first row looks
 * like a real column header (3+ cells, none of them an amount) instead comes
 * out as a proper table (rows keyed by header text), not flat label/amount.
 */
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog, type ParseLogEntry } from "@/lib/parseLog";
import { openProtectedDocument, tableRowsFrom } from "@/statements/documentIntake";
import { createAnnotator, type AnnotatedRow } from "@/statements/annotate";
import { alignRowToColumns, type DetectedColumn } from "@/statements/columnSnap";
import { parseAmount } from "@/statements/amount";
import type { PdfTableRow } from "@/statements/types";

export interface CaLineItem {
  label: string;
  amount: number;
  /** A second number found on the same row — a comparative-year figure, a
   *  running balance, or a tax amount, depending on the sheet. Meaning is
   *  ambiguous by design; surfaced as-is for the user to interpret during
   *  review rather than guessed at. */
  secondaryAmount: number | null;
}

export interface CaSection {
  /** Empty for the synthetic bucket holding line items that appeared before
   *  any section title was seen (rare, but keeps such rows visible instead
   *  of dropping them). */
  title: string;
  items: CaLineItem[];
  subsections: CaSection[];
}

export interface CaScheduleTable {
  headers: string[];
  rows: Record<string, string>[];
}

export interface CaSchedule {
  /** The token right after "Schedule", e.g. "CG", "VIA", "S". */
  name: string;
  /** Populated when no table header was detected in this schedule — same
   *  section/item shape as the main statement. Empty when `table` is set. */
  sections: CaSection[];
  /** Populated instead when the schedule has its own multi-column header
   *  row (e.g. asset / purchase date / sale date / gain). */
  table: CaScheduleTable | null;
}

/** The editable slice of a parsed CA sheet — everything a user might correct
 *  in the review YAML. Deliberately excludes `warnings`/`annotatedRows`,
 *  which stay derived from the original parse and are shown read-only. */
export interface CaComputationData {
  statementOfIncome: CaSection[];
  schedules: CaSchedule[];
}

export interface CaComputationParseResult extends CaComputationData {
  warnings: string[];
  /** The full document, geometry-reconstructed and annotated with which
   *  cells were recognized as which field — always present, for manual
   *  review regardless of how much was recognized. */
  annotatedRows: AnnotatedRow[];
}

export interface CaComputationPreview {
  result: CaComputationParseResult;
  passwordUsed: string | null;
  log: ParseLogEntry[];
}

const STATEMENT_START = /statement of (total )?income|computation of (total )?income/i;
const SCHEDULE_MARKER = /^schedule[\s-]+([a-z0-9]+)/i;
/** The "Rs." (or bare "Amount") column-header cue called out in the sheet —
 *  used only to SKIP a header row (so it isn't mistaken for an empty section
 *  title), never to bind a column position; the label/amount split below
 *  works off which cells parse as numbers, whatever the other column is named. */
const HEADER_SKIP = /\brs\.?\b|\bamount\b/i;
/** Tolerance (in PDF point units) for treating two section titles' cell x
 *  positions as "the same indent level" — real CA templates vary, so this is
 *  necessarily approximate; a misjudged nesting level still keeps the
 *  section/item itself intact and visible in the review YAML. */
const NEST_TOLERANCE = 8;

function rowText(row: PdfTableRow): string {
  return row.cells.map((c) => c.text.trim()).filter(Boolean).join(" ");
}

function isEmptyRow(row: PdfTableRow): boolean {
  return row.cells.every((c) => !c.text.trim());
}

interface OpenFrame {
  x: number;
  section: CaSection;
}

/**
 * Extracts the section/subsection/item tree from rows[start, end). Shared by
 * the main "Statement of Income" region and any Schedule that doesn't have
 * its own table header (see `detectScheduleTable`).
 */
function extractSections(
  rows: PdfTableRow[],
  start: number,
  end: number,
  annotator: ReturnType<typeof createAnnotator>,
): CaSection[] {
  const top: CaSection[] = [];
  const looseItems: CaLineItem[] = [];
  const stack: OpenFrame[] = [];
  let firstContentRow = true;

  const containerFor = (x: number): CaSection[] => {
    while (stack.length && x <= stack[stack.length - 1].x - NEST_TOLERANCE) stack.pop();
    if (stack.length === 0) return top;
    if (x > stack[stack.length - 1].x + NEST_TOLERANCE) return stack[stack.length - 1].section.subsections;
    // Roughly the same indent as the currently open section: a sibling, not a child.
    stack.pop();
    return stack.length ? stack[stack.length - 1].section.subsections : top;
  };

  for (let i = start; i < end; i++) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;

    const amountCells = row.cells
      .map((c) => parseAmount(c.text))
      .filter((v): v is number => v !== null);

    if (amountCells.length === 0) {
      const text = rowText(row);
      const wasFirst = firstContentRow;
      firstContentRow = false;
      if (wasFirst && HEADER_SKIP.test(text)) continue; // column-header row, not a section
      if (!text) continue;

      const x = row.cells[0]?.x ?? 0;
      const section: CaSection = { title: text, items: [], subsections: [] };
      containerFor(x).push(section);
      stack.push({ x, section });
      annotator.markRow(i, "ca-section");
      continue;
    }

    firstContentRow = false;
    const label = row.cells
      .filter((c) => parseAmount(c.text) === null)
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join(" ");
    const item: CaLineItem = {
      label,
      amount: amountCells[0],
      secondaryAmount: amountCells.length > 1 ? amountCells[1] : null,
    };
    if (stack.length) stack[stack.length - 1].section.items.push(item);
    else looseItems.push(item);
    annotator.markRow(i, "ca-item");
  }

  if (looseItems.length > 0) top.unshift({ title: "", items: looseItems, subsections: [] });
  return top;
}

/**
 * Checks whether a Schedule's first non-blank row is a real column header
 * (3+ populated cells, none of them an amount) and, if so, snaps every
 * following amount-bearing row into a table keyed by that header's own text —
 * reusing `alignRowToColumns` generically over `string` header text instead
 * of a fixed column-kind enum, the same column-snapping machinery every
 * other tabular PDF parser in this codebase uses. Returns null (falling back
 * to flat section/item extraction) when the schedule doesn't have this shape.
 */
function detectScheduleTable(
  rows: PdfTableRow[],
  start: number,
  end: number,
  annotator: ReturnType<typeof createAnnotator>,
): CaScheduleTable | null {
  let headerIdx = -1;
  for (let i = start; i < end; i++) {
    if (isEmptyRow(rows[i])) continue;
    const populated = rows[i].cells.filter((c) => c.text.trim());
    if (populated.length < 3) return null;
    if (populated.some((c) => parseAmount(c.text) !== null)) return null;
    headerIdx = i;
    break;
  }
  if (headerIdx === -1) return null;

  const headerRow = rows[headerIdx];
  const columns: DetectedColumn<string>[] = headerRow.cells
    .filter((c) => c.text.trim())
    .map((c) => ({ kind: c.text.trim(), x: c.x, width: c.width, header: c.text }));
  const headers = columns.map((c) => c.kind);
  headerRow.cells.forEach((c, idx) => { if (c.text.trim()) annotator.markCell(headerIdx, idx, "ca-schedule-header"); });

  const tableRows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < end; i++) {
    if (isEmptyRow(rows[i])) continue;
    if (!rows[i].cells.some((c) => parseAmount(c.text) !== null)) continue; // not a data row — skip rather than guess

    const aligned = alignRowToColumns(rows[i], columns, undefined, (cellIndex) =>
      annotator.markCell(i, cellIndex, "ca-schedule-cell"),
    );
    const tableRow: Record<string, string> = {};
    for (const h of headers) tableRow[h] = aligned[h] ?? "";
    tableRows.push(tableRow);
  }

  if (tableRows.length === 0) return null; // looked like a header but nothing usable followed
  return { headers, rows: tableRows };
}

export function parseCaComputationRows(tableRows: PdfTableRow[]): CaComputationParseResult {
  const warnings: string[] = [];
  const annotator = createAnnotator(tableRows);

  const headingRowIndex = tableRows.findIndex((r) => STATEMENT_START.test(rowText(r)));
  let scanStart: number;
  if (headingRowIndex === -1) {
    warnings.push('Couldn\'t find a "Statement of Income" heading — parsing from the top of the document; review carefully.');
    scanStart = 0;
  } else {
    annotator.markRow(headingRowIndex, "ca-heading");
    scanStart = headingRowIndex + 1;
  }

  const scheduleMarkers: { index: number; name: string }[] = [];
  for (let i = scanStart; i < tableRows.length; i++) {
    const m = SCHEDULE_MARKER.exec(rowText(tableRows[i]));
    if (m) scheduleMarkers.push({ index: i, name: m[1].toUpperCase() });
  }

  const statementEnd = scheduleMarkers.length ? scheduleMarkers[0].index : tableRows.length;
  const statementOfIncome = extractSections(tableRows, scanStart, statementEnd, annotator);

  const schedules: CaSchedule[] = scheduleMarkers.map((marker, i) => {
    annotator.markRow(marker.index, "ca-schedule-heading");
    const regionStart = marker.index + 1;
    const regionEnd = i + 1 < scheduleMarkers.length ? scheduleMarkers[i + 1].index : tableRows.length;
    const table = detectScheduleTable(tableRows, regionStart, regionEnd, annotator);
    const sections = table ? [] : extractSections(tableRows, regionStart, regionEnd, annotator);
    return { name: marker.name, sections, table };
  });

  if (statementOfIncome.length === 0 && schedules.length === 0) {
    warnings.push("No sections or schedules were recognized in this document — review the parsed document below manually.");
  }

  return { statementOfIncome, schedules, warnings, annotatedRows: annotator.rows() };
}

export async function previewCaComputation(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
): Promise<CaComputationPreview> {
  const log = createParseLog();
  const opened = await openProtectedDocument(bytes, filename, passwordCandidates, log);
  const rows = tableRowsFrom(opened, filename);
  const result = parseCaComputationRows(rows);
  void writeDebugDump("ca-computation", { filename, passwordUsed: opened.passwordUsed, rows, result, log: opened.log });
  return { result, passwordUsed: opened.passwordUsed, log: opened.log };
}

export const CA_COMPUTATION_SOURCE_PREFIX = "CACalc-PDF";

interface FlatCaRow {
  label: string;
  amount: number;
  sourcePath: string;
  note: string | null;
}

function flattenSections(sections: CaSection[], breadcrumb: string, out: FlatCaRow[]): void {
  for (const section of sections) {
    const nextBreadcrumb = section.title
      ? (breadcrumb ? `${breadcrumb} > ${section.title}` : section.title)
      : breadcrumb;
    for (const item of section.items) {
      if (!item.label.trim()) continue;
      const label = nextBreadcrumb ? `${nextBreadcrumb} > ${item.label.trim()}` : item.label.trim();
      out.push({
        label,
        amount: item.amount,
        sourcePath: CA_COMPUTATION_SOURCE_PREFIX,
        note: item.secondaryAmount !== null ? `secondary amount: ${item.secondaryAmount}` : null,
      });
    }
    flattenSections(section.subsections, nextBreadcrumb, out);
  }
}

/** Maps the parsed (and possibly user-corrected) hierarchy onto flat
 *  `myfinance_tax_ca_computation` rows — that table stays label/amount only
 *  (no schema change needed), so hierarchy is folded into a " > "-joined
 *  breadcrumb label; `caReconciliation.ts`'s keyword matcher does substring
 *  matching, so a prefixed label like "Schedule VIA > 80C" still matches a
 *  bare "80c" keyword fine. A schedule's own table rows (no single natural
 *  "amount") use the first column that parses as a number and keep the full
 *  row as JSON in `note` so nothing is lost even though only one figure is
 *  promoted to `amount`. */
export function caComputationToRows(data: CaComputationData): FlatCaRow[] {
  const rows: FlatCaRow[] = [];
  flattenSections(data.statementOfIncome, "", rows);

  for (const schedule of data.schedules) {
    const breadcrumb = `Schedule ${schedule.name}`;
    if (schedule.table) {
      schedule.table.rows.forEach((tableRow, i) => {
        let amount: number | null = null;
        for (const h of schedule.table!.headers) {
          const v = parseAmount(tableRow[h] ?? "");
          if (v !== null) { amount = v; break; }
        }
        if (amount === null) return;
        const firstValue = tableRow[schedule.table!.headers[0]] || `row ${i + 1}`;
        rows.push({
          label: `${breadcrumb}: ${firstValue}`,
          amount,
          sourcePath: CA_COMPUTATION_SOURCE_PREFIX,
          note: JSON.stringify(tableRow),
        });
      });
    } else {
      flattenSections(schedule.sections, breadcrumb, rows);
    }
  }

  return rows;
}

/** Leaf-item count across sections + subsections + schedules (flat or
 *  tabular) — what the review screen shows as "N line items". */
export function countCaLineItems(data: CaComputationData): number {
  return caComputationToRows(data).length;
}
