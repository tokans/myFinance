import type { PdfTableCell, PdfTableRow } from "./types";

/** A detected column, generic over the caller's own set of semantic kinds
 *  (e.g. bank-statement fields, or Form 26AS's deductor/TAN/amount fields). */
export interface DetectedColumn<K extends string> {
  kind: K;
  /** The header cell's x position — data rows snap their own cells to the
   *  nearest column by x, since a row missing a value (e.g. no debit on a
   *  credit row) simply has no cell there, shifting array indices between rows. */
  x: number;
  header: string;
  /** The header cell's width — defines the column's [x, x+width] span, which
   *  `nearestColumn` checks BEFORE point-distance (see there for why).
   *  Optional so callers/tests without cell widths still type-check; when
   *  absent, only point-distance matching applies for that column. */
  width?: number;
}

/**
 * Finds the header row (scanning the first `maxRowsToScan` rows for the one
 * whose cells best match `classify`) and returns its columns. Falls back to
 * row 0 if nothing scores well — callers should treat a low-confidence result
 * as needing user review.
 */
export function detectColumns<K extends string>(
  rows: PdfTableRow[],
  classify: (headerText: string) => K | null,
  maxRowsToScan = 10,
): { headerRowIndex: number; columns: DetectedColumn<K>[] } {
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, maxRowsToScan); i++) {
    const score = rows[i].cells.reduce((n, c) => n + (classify(c.text) !== null ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const header = rows[bestIndex];
  const columns = (header?.cells ?? [])
    .map((cell) => ({ kind: classify(cell.text), x: cell.x, header: cell.text, width: cell.width }))
    .filter((c) => c.kind !== null) as DetectedColumn<K>[];

  return { headerRowIndex: bestIndex, columns };
}

export interface TableSegment<K extends string> {
  headerRowIndex: number;
  columns: DetectedColumn<K>[];
  /** Exclusive — rows from `headerRowIndex + 1` up to (not including) this
   *  index belong to this segment. */
  endRowIndex: number;
}

/**
 * Finds EVERY plausible header row (not just the single best) and splits the
 * document into independent per-header segments — a real document can
 * contain more than one distinct table under this same column vocabulary
 * (Form 26AS's several quarterly TDS tables, Part A + Part A1, a multi-account
 * bank statement, ...). Each segment is scored/aligned independently, so a
 * later table isn't misread as stray data rows of the first one found.
 *
 * `minScore` is a floor on how many cells in a row must classify as a known
 * column before it counts as a real header (not an incidental data row that
 * happens to contain one recognizable word). Falls back to `detectColumns`'s
 * single-best-row behavior (as one segment spanning the whole table) if
 * nothing scores at or above the floor, so callers always get a result.
 */
export function detectTableSegments<K extends string>(
  rows: PdfTableRow[],
  classify: (headerText: string) => K | null,
  opts: { minScore?: number } = {},
): TableSegment<K>[] {
  const minScore = opts.minScore ?? 2;
  const segments: TableSegment<K>[] = [];

  for (let i = 0; i < rows.length; i++) {
    const score = rows[i].cells.reduce((n, c) => n + (classify(c.text) !== null ? 1 : 0), 0);
    if (score < minScore) continue;

    const columns = rows[i].cells
      .map((cell) => ({ kind: classify(cell.text), x: cell.x, header: cell.text, width: cell.width }))
      .filter((c) => c.kind !== null) as DetectedColumn<K>[];

    segments.push({ headerRowIndex: i, columns, endRowIndex: rows.length });
  }

  for (let s = 0; s < segments.length - 1; s++) {
    segments[s].endRowIndex = segments[s + 1].headerRowIndex;
  }

  if (segments.length === 0) {
    const best = detectColumns(rows, classify);
    return [{ ...best, endRowIndex: rows.length }];
  }

  return segments;
}

/** Default cap on how far a cell can be from a column's header x-position and
 *  still count as belonging to it — generous enough for realistic per-row
 *  jitter (numbers right-aligning, slightly shifted glyph origins, ...) but
 *  well under the gap to an entirely unrelated table's columns. Without a
 *  cap, nearest-neighbor matching always finds *some* column no matter how
 *  far away, silently attributing a completely different table's content
 *  (e.g. an interspersed income table) to whichever known column is least far. */
const DEFAULT_MAX_COLUMN_DISTANCE = 50;

/** Snaps a data row's cells to the detected columns by nearest x-position
 *  (within `maxDistance`), joining multiple cells that land in the same
 *  column with a space. A cell too far from every column is left unmatched.
 *  `onMatch`, if given, is called for every cell that DID match — callers use
 *  it to annotate the original raw cell (see `annotate.ts`) with which field
 *  it was recognized as, alongside building the returned field map. */
export function alignRowToColumns<K extends string>(
  row: PdfTableRow,
  columns: DetectedColumn<K>[],
  maxDistance = DEFAULT_MAX_COLUMN_DISTANCE,
  onMatch?: (cellIndex: number, kind: K) => void,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  row.cells.forEach((cell, cellIndex) => {
    const nearest = nearestColumn(cell, columns, maxDistance);
    if (!nearest) return;
    out[nearest.kind] = out[nearest.kind] ? `${out[nearest.kind]} ${cell.text}` : cell.text;
    onMatch?.(cellIndex, nearest.kind);
  });
  return out;
}

/**
 * A row with none of its identifying fields populated usually isn't a new
 * entry at all — it's the tail of the previous row's content that overflowed
 * onto its own physical line (a long narration, deductor name, category
 * label, ...). This is especially common as the very FIRST data row right
 * after a segment's header: when a table's header repeats at the top of
 * every page (Form 26AS, some bank statements), a new `TableSegment` starts
 * there, and the last entry's wrapped remainder from the bottom of the
 * previous page commonly lands as that new segment's opening row — but since
 * callers loop over segments independently, nothing here needs to
 * special-case "first row of a segment" vs. "mid-segment": the caller just
 * keeps folding onto whatever entry it last pushed, across segment
 * boundaries too.
 *
 * Deciding whether a row IS such a continuation is the caller's job, not
 * this function's — a numeric identifying field (an amount) needs its
 * PARSED value checked, not just whether some text landed in that column's
 * x-band (an unrelated row's stray text can land there without being a
 * number at all, e.g. a letterhead fragment overlapping the amount column's
 * tolerance). This just returns the row's own text (every cell — a
 * continuation row has nothing else meaningful in it) to fold onto whichever
 * entry preceded it, or null if the row has no text worth folding at all.
 */
export function continuationText(row: PdfTableRow): string | null {
  const text = row.cells
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join(" ");
  return text || null;
}

/**
 * Finds rows whose full text repeats verbatim `minRepeats` or more times
 * across the document — page furniture (a restated letterhead line, a
 * footer disclaimer, a GSTIN notice) that a bank/tax PDF prints on every
 * page, interleaved with real table rows rather than confined to a header/
 * footer PDFium exposes separately. A genuine transaction/entry row never
 * repeats byte-for-byte (its own date/amount make it unique), so verbatim
 * recurrence is a reliable, institution-agnostic signal that a row is NOT
 * part of the table — unlike `continuationText`'s callers, which can only
 * tell a genuine narration wrap from unrelated boilerplate by content-free
 * heuristics (blank-row gaps, a fold-count cap) and so can be fooled by
 * boilerplate that runs directly into the last transaction with no gap.
 *
 * One exception: a table's header can legitimately repeat once per page
 * (Form 26AS, some bank statements) — rows `classify` recognizes as a
 * header are never flagged even if they recur, leaving
 * `detectTableSegments`'s per-page-header logic untouched.
 */
export function findBoilerplateRows<K extends string>(
  rows: PdfTableRow[],
  classify: (headerText: string) => K | null,
  opts: { minRepeats?: number; headerMinScore?: number } = {},
): Set<number> {
  const minRepeats = opts.minRepeats ?? 3;
  const headerMinScore = opts.headerMinScore ?? 2;

  const signature = (row: PdfTableRow): string =>
    row.cells
      .map((c) => c.text.trim().toLowerCase().replace(/\s+/g, " "))
      .filter(Boolean)
      .join("|");

  const signatures = rows.map(signature);
  const counts = new Map<string, number>();
  for (const sig of signatures) {
    if (sig) counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }

  const isHeaderRow = (row: PdfTableRow): boolean =>
    row.cells.reduce((n, c) => n + (classify(c.text) !== null ? 1 : 0), 0) >= headerMinScore;

  const boilerplate = new Set<number>();
  rows.forEach((row, i) => {
    const sig = signatures[i];
    if (!sig || (counts.get(sig) ?? 0) < minRepeats) return;
    if (isHeaderRow(row)) return;
    boilerplate.add(i);
  });

  return boilerplate;
}

function nearestColumn<K extends string>(
  cell: PdfTableCell,
  columns: DetectedColumn<K>[],
  maxDistance: number,
): DetectedColumn<K> | null {
  // Span containment is checked FIRST, ahead of point-distance. A header
  // whose label glues two sub-columns' text into one wide cell (e.g. a bank
  // statement's "Value Dt Withdrawal Amt." header) sits far to the LEFT of
  // where its own right-aligned data actually renders — close enough to the
  // NEXT column's header that raw point-distance to that neighbor can beat
  // the distance to its own (mislabeled) header. That makes point-distance
  // matching "succeed" on the WRONG column outright — e.g. a real-world HDFC
  // statement had 2/3 of its withdrawal amounts land in the deposit column
  // this way — rather than merely finding nothing, so a fallback that only
  // runs after point-matching fails never gets a chance to correct it. A
  // cell's x actually falling inside a column's own printed [x, x+width]
  // span is a stronger, more direct signal than distance-to-header-x, so it
  // takes priority; point-distance remains the fallback for columns with no
  // recorded width (e.g. hand-built columns in tests) or when no span
  // contains the cell at all.
  for (const col of columns) {
    if (col.width === undefined) continue;
    if (cell.x >= col.x && cell.x <= col.x + col.width) return col;
  }

  let best: DetectedColumn<K> | null = null;
  let bestDist = Infinity;
  for (const col of columns) {
    const dist = Math.abs(cell.x - col.x);
    if (dist < bestDist) {
      bestDist = dist;
      best = col;
    }
  }
  return bestDist <= maxDistance ? best : null;
}
