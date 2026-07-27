import { describe, expect, it } from "vitest";
import { createAnnotator } from "./annotate";
import type { PdfTableRow } from "./types";

function row(pageIndex: number, rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: pageIndex,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: 20 })),
  };
}

describe("createAnnotator", () => {
  it("scaffolds every row/cell as unrecognized by default", () => {
    const rows = [row(0, 0, [["a", 10], ["b", 100]]), row(0, 1, [["c", 10]])];
    const annotated = createAnnotator(rows).rows();

    expect(annotated).toEqual([
      { pageIndex: 0, rowIndex: 0, cells: [{ text: "a", x: 10, width: 20, field: null }, { text: "b", x: 100, width: 20, field: null }] },
      { pageIndex: 0, rowIndex: 1, cells: [{ text: "c", x: 10, width: 20, field: null }] },
    ]);
  });

  it("markCell tags exactly one cell, leaving the rest unrecognized", () => {
    const annotator = createAnnotator([row(0, 0, [["a", 10], ["b", 100]])]);
    annotator.markCell(0, 1, "amount");

    const [r] = annotator.rows();
    expect(r.cells[0].field).toBeNull();
    expect(r.cells[1].field).toBe("amount");
  });

  it("markRow tags every cell in that row", () => {
    const annotator = createAnnotator([row(0, 0, [["a", 10], ["b", 100]]), row(0, 1, [["c", 10]])]);
    annotator.markRow(0, "partB");

    const rows = annotator.rows();
    expect(rows[0].cells.every((c) => c.field === "partB")).toBe(true);
    expect(rows[1].cells[0].field).toBeNull();
  });

  it("keeps separate annotator instances independent", () => {
    const rows = [row(0, 0, [["a", 10]])];
    const first = createAnnotator(rows);
    const second = createAnnotator(rows);
    first.markCell(0, 0, "date");

    expect(first.rows()[0].cells[0].field).toBe("date");
    expect(second.rows()[0].cells[0].field).toBeNull();
  });

  it("preserves page/row indices and cell order from the source rows", () => {
    const annotator = createAnnotator([row(2, 5, [["x", 1], ["y", 2], ["z", 3]])]);
    const [r] = annotator.rows();
    expect(r.pageIndex).toBe(2);
    expect(r.rowIndex).toBe(5);
    expect(r.cells.map((c) => c.text)).toEqual(["x", "y", "z"]);
  });
});
