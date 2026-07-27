import type { PdfTableRow } from "./types";

/** A raw cell tagged with whichever field a domain classifier recognized it
 *  as (e.g. "date", "debit", "deductor"), or `null` if nothing claimed it. */
export interface AnnotatedCell {
  text: string;
  x: number;
  width: number;
  field: string | null;
}

export interface AnnotatedRow {
  pageIndex: number;
  rowIndex: number;
  cells: AnnotatedCell[];
}

/**
 * Scaffolds every row/cell from a raw `PdfTableRow[]` extraction as
 * unrecognized (`field: null`), then hands back mutators a domain parser
 * calls as it classifies cells/rows — so the final `.rows()` is the SAME
 * nested structure the document was extracted into (pages -> rows -> cells),
 * just annotated with what step 2 understood, rather than a separate lossy
 * "raw table" built only from whatever was left over.
 */
export function createAnnotator(rows: PdfTableRow[]) {
  const annotated: AnnotatedRow[] = rows.map((r) => ({
    pageIndex: r.page_index,
    rowIndex: r.row_index,
    cells: r.cells.map((c) => ({ text: c.text, x: c.x, width: c.width, field: null as string | null })),
  }));

  return {
    /** Marks one cell as recognized for `field`. */
    markCell(rowIndex: number, cellIndex: number, field: string): void {
      annotated[rowIndex].cells[cellIndex].field = field;
    },
    /** Marks every cell in a row as recognized for `field` — for parsers
     *  that only know a whole row belongs to something, not which cell. */
    markRow(rowIndex: number, field: string): void {
      for (const cell of annotated[rowIndex].cells) cell.field = field;
    },
    rows(): AnnotatedRow[] {
      return annotated;
    },
  };
}
