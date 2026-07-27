/**
 * Structural extractor for AIS-PDF's per-SOURCE table — "SR. NO. INFORMATION
 * CODE | INFORMATION DESCRIPTION | INFORMATION SOURCE | COUNT | AMOUNT" —
 * verified identical under both Part B1 (TDS/TCS) and Part B2 (SFT), each
 * followed immediately by a per-transaction "Information Source-wise
 * Details" table (date, amount, TDS deducted, Active/Inactive status; exact
 * columns vary by section — a bank-interest block has ACCOUNT NUMBER/TYPE,
 * a TDS block has QUARTER/TDS DEDUCTED, ...).
 *
 * This exists alongside `categoryAmountPdf.ts`'s flat category+amount table
 * rather than replacing it: that one is a lossy AGGREGATE per category (fine
 * for a quick total, and kept as the user-editable review surface), this one
 * is per SOURCE with the underlying transactions preserved — the payer name
 * (for entity-matching against Form16/26AS, `domain/recon.ts`) and
 * per-transaction date/amount/status (for bank-transaction reconciliation)
 * that a flat category+amount row has no way to represent.
 *
 * Bucketing into `tdsTcs` vs `sft` mirrors `aisParser.ts`'s JSON-path design
 * exactly: `sft` reports the SAME dividends/interest/etc. from a different
 * source, so it's kept structurally separate and never folded into income —
 * see `db/aisSft.ts`'s `replaceSftForAy` (until now fed only by the JSON
 * path; `aisPdf.ts` wires this module into the same table).
 */
import { alignRowToColumns, detectTableSegments } from "@/statements/columnSnap";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

import type { PdfTableRow } from "@/statements/types";


/** Matches any AIS "Part B<n> - ..." section heading.
 *
 *  The trailing lookahead does the job of a `` word boundary. It is written
 *  this way deliberately: an earlier copy of this constant reached the file
 *  with the `` collapsed into a literal 0x08 backspace byte, which made the
 *  regex demand a control character and silently match nothing — every Part-B
 *  section came back empty with no error anywhere. A lookahead cannot be
 *  mangled the same way by a tool that interprets string escapes. */
const PART_SECTION_MARKER = /^part\s*b(\d+)(?![0-9a-z])/i;

/**
 * Row range of the first "Part B<n>" section whose heading satisfies
 * `matchesHeading` (start = the heading row, end exclusive at the next such
 * heading or end of document), or null when absent.
 *
 * Lives here rather than in `categoryAmountPdf.ts` (its original home) because
 * that module now reads a structured `DocModel`, where a section is a section
 * and this scan is unnecessary. This module is still a geometry parser, so it
 * keeps the scan until it is migrated too.
 */
function findSectionRange(
  tableRows: PdfTableRow[],
  matchesHeading: (headingText: string, partNumber: number) => boolean,
): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < tableRows.length; i++) {
    for (const cell of tableRows[i].cells) {
      const text = cell.text.trim();
      const m = PART_SECTION_MARKER.exec(text);
      if (m && matchesHeading(text, Number(m[1]))) { start = i; break; }
    }
    if (start !== -1) break;
  }
  if (start === -1) return null;

  for (let i = start + 1; i < tableRows.length; i++) {
    if (tableRows[i].cells.some((c) => PART_SECTION_MARKER.test(c.text.trim()))) return { start, end: i };
  }
  return { start, end: tableRows.length };
}

export interface AisTransaction {
  /** ISO date, from whichever detail column named a date ("DATE OF PAYMENT/
   *  CREDIT", "REPORTED ON", ...) — null if none was recognized. */
  date: string | null;
  /** The transaction's own amount (e.g. "AMOUNT PAID/CREDITED", or the
   *  glued "<amount> Active"/"<amount> Inactive" cell some sections use). */
  amount: number | null;
  /** TDS actually withheld on this transaction — present only for TDS/TCS-
   *  section detail tables, which carry a distinct "TDS DEDUCTED" column
   *  (an SFT section's detail table never has one). */
  tdsDeducted: number | null;
  /** "Active" / "Inactive" — AIS keeps superseded/corrected transactions in
   *  the same list; only "Active" rows should count toward any total (see
   *  aisParser.ts's identical guard on the JSON path). */
  status: string | null;
  /** Every column this detail table actually had, keyed by its own header
   *  text (or `col0`, `col1`, ... when the header was one glued cell with no
   *  real column split) — nothing is lost even for a shape not specially
   *  recognized above (account number, account type, quarter, security, ...). */
  raw: Record<string, string>;
}

export interface AisSourceEntry {
  /** e.g. "TDS-192", "SFT-015", "TDS-Ann.II-SAL". */
  code: string;
  /** e.g. "Salary received (Section 192)", "Dividend income (SFT-015)". */
  category: string;
  /** Raw "NAME (TAN/PAN)" text, or null if this source had no name at all. */
  source: string | null;
  /** `source` with its trailing "(...)" stripped off. */
  sourceName: string | null;
  /** The trailing "(...)" content — a TAN or PAN, whichever this source used. */
  sourceId: string | null;
  count: number | null;
  /** The source-summary row's own total — authoritative, matches the AIS
   *  Utility JSON's figure for the same source (verified against a real
   *  export: source-level totals agree to the rupee). */
  amount: number | null;
  transactions: AisTransaction[];
}

export interface AisSourceDetailResult {
  /** Part B1 — feeds income (by head) and TDS/TCS payment rows, with a
   *  payer name recon can entity-match against Form16/26AS. */
  tdsTcs: AisSourceEntry[];
  /** Part B2 — feeds ONLY the SFT cross-check table, never income (see the
   *  module doc comment on why summing both would double-count). */
  sft: AisSourceEntry[];
  warnings: string[];
}

const TDS_TCS_HEADING = /tax deducted or collected at source/i;
const SFT_HEADING = /specified financial transaction/i;

const SOURCE_HEADER_WORDS: Array<[string, RegExp]> = [
  ["code", /information code/i],
  ["description", /information description/i],
  ["source", /information source/i],
  ["count", /^count$/i],
  ["amount", /^amount$/i],
];

function classifySourceHeaderCell(text: string): string | null {
  const t = text.trim();
  for (const [kind, re] of SOURCE_HEADER_WORDS) if (re.test(t)) return kind;
  return null;
}

/** Strips a leading bare "<n> " that glues onto the code/description text
 *  when the SR.No. column sits inside the same wide header span as its
 *  neighbor — same phenomenon (and same fix) as `categoryAmountPdf.ts`'s
 *  `LEADING_SR_NO`. */
const LEADING_SR_NO = /^\d{1,3}\s+/;

/** Splits "NAME (TAN/PAN)" into its two parts. Falls back to treating the
 *  whole string as the name if it has no trailing parenthetical. */
function splitSource(raw: string): { sourceName: string | null; sourceId: string | null } {
  const m = /^(.*)\(([^()]+)\)\s*$/.exec(raw.trim());
  if (!m) return { sourceName: raw.trim() || null, sourceId: null };
  return { sourceName: m[1].trim() || null, sourceId: m[2].trim() || null };
}

const DATE_KEY = /date|reported on/i;
const STATUS_KEY = /status/i;
// "tax collected" catches Section 194K's own column vocabulary ("TAX
// COLLECTED"/"TCS DEPOSITED STATUS" instead of "TDS DEDUCTED") — a real AIS
// export uses this wording specifically for mutual-fund-dividend TCS rows,
// verified against a live document.
const TDS_KEY = /tds deducted|tax collected/i;
const AMOUNT_KEY = /amount|dividend|interest/i;

/** A cell shaped like "<amount>" or "<amount> Active"/"<amount> Inactive" —
 *  several detail-table shapes glue the status word onto the amount cell
 *  with no other separator. */
const AMOUNT_STATUS_CELL = /^([\d,]+(?:\.\d+)?)\s*(Active|Inactive)?$/i;

function amountAndStatus(text: string): { amount: number | null; status: string | null } {
  const m = AMOUNT_STATUS_CELL.exec(text.trim());
  if (!m) return { amount: parseAmount(text), status: null };
  return { amount: parseAmount(m[1]), status: m[2] ?? null };
}

/** Builds one transaction from a row already aligned to the detail header's
 *  OWN columns (the common case: a header with several genuinely separate
 *  cells, e.g. TDS/TCS's QUARTER/DATE/AMOUNT PAID/TDS DEDUCTED/STATUS, or
 *  SFT-016's REPORTED ON/ACCOUNT NUMBER/ACCOUNT TYPE/INTEREST AMOUNT STATUS). */
function transactionFromAligned(aligned: Partial<Record<string, string>>): AisTransaction | null {
  const keys = Object.keys(aligned);
  if (keys.length === 0) return null;
  const raw: Record<string, string> = {};
  for (const k of keys) raw[k] = aligned[k] ?? "";

  const dateKey = keys.find((k) => DATE_KEY.test(k));
  const statusKey = keys.find((k) => STATUS_KEY.test(k));
  const tdsKey = keys.find((k) => k !== statusKey && TDS_KEY.test(k));
  const amountKey = keys.find((k) => k !== statusKey && k !== tdsKey && k !== dateKey && AMOUNT_KEY.test(k));

  const date = dateKey ? parseStatementDate(raw[dateKey]) : null;
  const fromStatusCell = statusKey ? amountAndStatus(raw[statusKey]) : { amount: null, status: null };
  const amount = amountKey ? parseAmount(raw[amountKey]) : fromStatusCell.amount;
  const tdsDeducted = tdsKey ? parseAmount(raw[tdsKey]) : null;

  if (date === null && amount === null && tdsDeducted === null) return null;
  return { date, amount, tdsDeducted, status: fromStatusCell.status, raw };
}

/** Builds one transaction directly from a row's own (still properly
 *  PDFium-segmented) cells, for the shape where the detail header is a
 *  single wide glued cell with no real column split (e.g. SFT-015, whose
 *  header text is one cell: "SR. NO. REPORTED ON DIVIDEND AMOUNT STATUS") —
 *  column-x alignment can't split THAT header, but the data rows underneath
 *  it are still separate cells, so working off them directly still recovers
 *  date/amount/status correctly. */
function transactionFromCells(cellsText: string[]): AisTransaction | null {
  let date: string | null = null;
  let amount: number | null = null;
  let status: string | null = null;
  const raw: Record<string, string> = {};
  let col = 0;

  for (const raw0 of cellsText) {
    const t = raw0.trim();
    if (!t) continue;
    if (date === null) {
      const d = parseStatementDate(t);
      if (d) { date = d; continue; }
    }
    if (amount === null && date === null && /^\d{1,3}$/.test(t)) continue; // leading SR.No.
    if (amount === null) {
      const m = AMOUNT_STATUS_CELL.exec(t);
      if (m) {
        amount = parseAmount(m[1]);
        status = m[2] ?? status;
        continue;
      }
    }
    raw[`col${col++}`] = t;
  }

  if (date === null && amount === null) return null;
  return { date, amount, tdsDeducted: null, status, raw };
}

/** How close a cell's x has to be to a column's own x to count as belonging
 *  to it — generous enough for the category/source columns' own text to
 *  drift a little, tight enough not to false-match the detail header's SR.
 *  No. column, which sits far to the left (x≈15) of both. */
const WRAP_COLUMN_TOLERANCE = 30;

function nearestWrapColumn(x: number, candidates: Array<[string, number]>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [key, cx] of candidates) {
    const d = Math.abs(x - cx);
    if (d < bestDist) { bestDist = d; best = key; }
  }
  return bestDist <= WRAP_COLUMN_TOLERANCE ? best : null;
}

/**
 * A long category description or source name wraps onto its own physical
 * row right after the summary data row — e.g. `Interest other than
 * "Interest on Securities" received` continuing as `(Section 194A)` on the
 * next row, or a long source name continuing as `EAST (MUMD00004D)`,
 * sometimes both on the SAME continuation row (one cell per wrapped
 * column). This is NOT the detail table's own header (which starts at
 * x≈15, the SR.No. column, far to the left of both) — recognized here by
 * every cell in the row landing in the description/source columns' own x
 * band, so `extractSourceEntries` can skip past it (reconstructing the full
 * wrapped text) to find the REAL detail header instead of misreading this
 * row as a 1-2-column detail header and cascading everything after it.
 */
function isWrappedContinuationRow(row: PdfTableRow, candidates: Array<[string, number]>): boolean {
  if (row.cells.length === 0 || candidates.length === 0) return false;
  return row.cells.every((c) => nearestWrapColumn(c.x, candidates) !== null);
}

function extractTransactions(rows: PdfTableRow[], detailHeaderIndex: number, endExclusive: number): AisTransaction[] {
  const headerRow = rows[detailHeaderIndex];
  const out: AisTransaction[] = [];

  if (headerRow.cells.length >= 3) {
    const columns = headerRow.cells.map((c) => ({ kind: c.text.trim(), x: c.x, header: c.text, width: c.width }));
    for (let i = detailHeaderIndex + 1; i < endExclusive; i++) {
      const aligned = alignRowToColumns(rows[i], columns);
      const tx = transactionFromAligned(aligned);
      if (tx) out.push(tx);
    }
  } else {
    for (let i = detailHeaderIndex + 1; i < endExclusive; i++) {
      const tx = transactionFromCells(rows[i].cells.map((c) => c.text));
      if (tx) out.push(tx);
    }
  }
  return out;
}

/** Extracts every source-summary entry (+ its transactions) within a Part-B
 *  section's row range. `detectTableSegments` finds every occurrence of the
 *  5-column source-summary header (one per source, repeating throughout the
 *  section) — the row right after it is the summary data row, the row after
 *  THAT is the detail table's own header, positionally, since the shape is
 *  fixed: [summary header][summary data row][detail header][detail rows...],
 *  repeated once per source (verified against a real export across TDS/TCS,
 *  SFT-015, and SFT-016 blocks alike). */
function extractSourceEntries(tableRows: PdfTableRow[], range: { start: number; end: number }): AisSourceEntry[] {
  const scoped = tableRows.slice(range.start, range.end);
  const segments = detectTableSegments(scoped, classifySourceHeaderCell, { minScore: 3 });
  const entries: AisSourceEntry[] = [];

  for (const segment of segments) {
    const dataRowIndex = segment.headerRowIndex + 1;
    if (dataRowIndex >= segment.endRowIndex) continue;

    const aligned = alignRowToColumns(scoped[dataRowIndex], segment.columns);
    const code = (aligned.code ?? "").replace(LEADING_SR_NO, "").trim();
    if (!code && !aligned.description) continue;

    const count = aligned.count ? parseAmount(aligned.count) : null;
    const amount = aligned.amount ? parseAmount(aligned.amount) : null;

    // Skip past any wrapped category/source continuation row(s) — see
    // isWrappedContinuationRow — reconstructing the full text as we go, so
    // the detail header search below lands on the REAL detail header.
    const descX = segment.columns.find((c) => c.kind === "description")?.x;
    const srcX = segment.columns.find((c) => c.kind === "source")?.x;
    const wrapCandidates: Array<[string, number]> = [];
    if (descX !== undefined) wrapCandidates.push(["description", descX]);
    if (srcX !== undefined) wrapCandidates.push(["source", srcX]);

    let categoryText = (aligned.description ?? "").trim();
    let sourceText = aligned.source?.trim() ?? "";
    let detailHeaderIndex = dataRowIndex + 1;
    while (detailHeaderIndex < segment.endRowIndex && isWrappedContinuationRow(scoped[detailHeaderIndex], wrapCandidates)) {
      for (const cell of scoped[detailHeaderIndex].cells) {
        const target = nearestWrapColumn(cell.x, wrapCandidates);
        if (target === "description") categoryText = `${categoryText} ${cell.text.trim()}`.trim();
        else if (target === "source") sourceText = `${sourceText} ${cell.text.trim()}`.trim();
      }
      detailHeaderIndex++;
    }
    const category = categoryText;
    const source = sourceText || null;
    const { sourceName, sourceId } = splitSource(source ?? "");

    const transactions =
      detailHeaderIndex < segment.endRowIndex ? extractTransactions(scoped, detailHeaderIndex, segment.endRowIndex) : [];

    // A source's transaction list can span a page break, restarting the
    // 5-column summary header (and repeating the identical summary row) on
    // the next page — merge onto the previous entry instead of duplicating it.
    const prev = entries[entries.length - 1];
    if (prev && prev.code === code && prev.category === category && prev.source === source) {
      prev.transactions.push(...transactions);
      continue;
    }

    entries.push({ code, category, source, sourceName, sourceId, count, amount, transactions });
  }
  return entries;
}

export function parseAisSourceDetail(tableRows: PdfTableRow[]): AisSourceDetailResult {
  const warnings: string[] = [];

  const tdsRange = findSectionRange(tableRows, (heading) => TDS_TCS_HEADING.test(heading));
  const sftRange = findSectionRange(tableRows, (heading) => SFT_HEADING.test(heading));

  const tdsTcs = tdsRange ? extractSourceEntries(tableRows, tdsRange) : [];
  const sft = sftRange ? extractSourceEntries(tableRows, sftRange) : [];

  if (tdsTcs.length === 0 && sft.length === 0) {
    warnings.push(
      "No per-source 'Information Code / Description / Source / Count / Amount' table was found — this document may not be a per-source AIS-PDF export.",
    );
  }

  return { tdsTcs, sft, warnings };
}
