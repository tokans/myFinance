/**
 * Read formulas from an xlsx file (via SheetJS), cluster them, and deduce the
 * data region of a sheet from "vertical aggregating" formulas like SUM, AVERAGE,
 * SUMPRODUCT — i.e. formulas that live at the bottom of a column and reference
 * the cells above them in the same column.
 *
 * Cross-sheet (=Sheet2!B2:B10) and cross-workbook (=[file.xlsx]Sheet!B2)
 * references are deliberately ignored — only formulas confined to the sheet
 * itself contribute to the deduction.
 */

import type { CrossSheetPattern, FormulaCell, FormulaInsight, SheetRaw } from "./types";

interface RangeRef {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

const RANGE_RE = /\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/g;

/**
 * Extract A1-style range refs from a formula string, ignoring any range that
 * is preceded by `!` (cross-sheet ref) or contained inside a string literal.
 */
export function extractLocalRanges(formula: string): RangeRef[] {
  // Strip string literals so quoted "B2:B10" doesn't fool the regex.
  const stripped = formula.replace(/"[^"]*"/g, '""');

  // If the formula references another workbook ([file]…), bail entirely.
  if (stripped.includes("[")) return [];

  const out: RangeRef[] = [];
  RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANGE_RE.exec(stripped)) !== null) {
    if (m.index > 0 && stripped[m.index - 1] === "!") continue; // cross-sheet
    const c1 = colLettersToIndex(m[1]);
    const c2 = colLettersToIndex(m[3]);
    if (c1 < 0 || c2 < 0) continue;
    const r1 = Number(m[2]) - 1;
    const r2 = Number(m[4]) - 1;
    out.push({
      startRow: Math.min(r1, r2),
      endRow: Math.max(r1, r2),
      startCol: Math.min(c1, c2),
      endCol: Math.max(c1, c2),
    });
  }
  return out;
}

export function colLettersToIndex(letters: string): number {
  if (!letters) return -1;
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    const ch = letters.charCodeAt(i);
    if (ch < 65 || ch > 90) return -1; // not A-Z
    n = n * 26 + (ch - 64);
  }
  return n - 1;
}

export function colIndexToLetters(idx: number): string {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Given all formulas in a sheet, find the most likely (totalRow, valueCols, dataRange).
 *
 * Heuristic:
 * 1. Group formulas by the row they live in.
 * 2. For each row, keep only formulas whose first local range is a *vertical*
 *    range in the same column (column-matching SUMs).
 * 3. Pick the row with the most such formulas; ties broken by earliest row.
 * 4. Within that row, take majority vote on the data start/end rows.
 */
export function analyzeFormulas(formulas: FormulaCell[]): FormulaInsight | null {
  if (formulas.length === 0) return null;

  // Group by row.
  const byRow = new Map<number, FormulaCell[]>();
  for (const f of formulas) {
    const arr = byRow.get(f.row);
    if (arr) arr.push(f);
    else byRow.set(f.row, [f]);
  }

  interface Candidate {
    row: number;
    cols: number[];
    rowStarts: number[];
    rowEnds: number[];
  }
  const candidates: Candidate[] = [];

  for (const [row, cells] of byRow) {
    const cols: number[] = [];
    const rowStarts: number[] = [];
    const rowEnds: number[] = [];
    for (const f of cells) {
      const ranges = extractLocalRanges(f.formula);
      if (ranges.length === 0) continue;
      const r = ranges[0];
      // Vertical, same column, range above the formula's row.
      if (r.startCol === r.endCol && r.startCol === f.col && r.endRow < row && r.startRow >= 0) {
        cols.push(f.col);
        rowStarts.push(r.startRow);
        rowEnds.push(r.endRow);
      }
    }
    if (cols.length > 0) candidates.push({ row, cols, rowStarts, rowEnds });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.cols.length - a.cols.length || a.row - b.row);
  const best = candidates[0];

  const dataStartRow = majority(best.rowStarts);
  const dataEndRow = majority(best.rowEnds);
  const agree = best.rowStarts.filter(
    (s, i) => s === dataStartRow && best.rowEnds[i] === dataEndRow,
  ).length;

  // Dedup + sort value columns.
  const valueCols = Array.from(new Set(best.cols)).sort((a, b) => a - b);

  return {
    totalRow: best.row,
    valueCols,
    dataStartRow,
    dataEndRow,
    confidence: agree / best.cols.length,
    formulaCount: best.cols.length,
  };
}

function majority(xs: number[]): number {
  if (xs.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = xs[0], bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

/**
 * Find the strongest shared pattern across multiple sheets, if any. A "pattern"
 * is a triple (totalRow, valueCols, dataStartRow, dataEndRow) shared by at
 * least two sheets. Returns the pattern matching the most sheets.
 */
export function findCrossSheetPattern(
  sheets: SheetRaw[],
  insights: Record<string, FormulaInsight>,
): CrossSheetPattern | null {
  const keyed = new Map<string, { insight: FormulaInsight; sheets: string[] }>();
  for (const s of sheets) {
    const ins = insights[s.name];
    if (!ins) continue;
    const key = `${ins.totalRow}|${ins.valueCols.join(",")}|${ins.dataStartRow}-${ins.dataEndRow}`;
    const existing = keyed.get(key);
    if (existing) existing.sheets.push(s.name);
    else keyed.set(key, { insight: ins, sheets: [s.name] });
  }

  // Pick the largest cluster (≥ 1 sheet — even one sheet's pattern is informative).
  let best: { insight: FormulaInsight; sheets: string[] } | null = null;
  for (const v of keyed.values()) {
    if (!best || v.sheets.length > best.sheets.length) best = v;
  }
  if (!best) return null;

  return {
    totalRow: best.insight.totalRow,
    valueCols: best.insight.valueCols,
    dataStartRow: best.insight.dataStartRow,
    dataEndRow: best.insight.dataEndRow,
    matchingSheets: best.sheets,
    totalSheets: sheets.length,
    confidence: best.sheets.length / sheets.length,
  };
}
