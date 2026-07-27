import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { FORM16_DOC_OPTIONS } from "./form16";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

import { parseForm16PartB } from "./form16PartB";
import type { PdfTableRow } from "@/statements/types";

function row(rowIndex: number, text: string): PdfTableRow {
  return { page_index: 0, row_index: rowIndex, cells: [{ text, x: 30, width: 540 }] };
}

/** Every real document has "PART B" as its own row before the annexure
 *  content starts — parseForm16PartB only looks past that marker. */
function withPartBMarker(rows: PdfTableRow[]): PdfTableRow[] {
  return [row(-1, "PART B"), ...rows];
}

/** The row fixtures are real Form 16 layouts; only the seam changed. */
function modelOf(rows: PdfTableRow[]) {
  return buildDocModel(
    { doc: fromNativeRows(rows), filename: "form16.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate, ...FORM16_DOC_OPTIONS },
  );
}

/**
 * The real page geometry: marker, label and amount are separate columns.
 *
 * Every other fixture here puts a whole row in ONE wide cell, and that is why
 * they all kept passing while a real certificate lost 23 of its 82 line items:
 * a single-cell row is never structured as a table, so nothing ever folds. The
 * layout below is the one that actually breaks — a long label printed AROUND
 * its own marker row, so the marker row looks exactly like a wrapped
 * continuation of the label above it.
 */
function cellRow(rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: Math.max(text.length * 5, 12) })),
  };
}

describe("parseForm16PartB", () => {
  it("keeps every sub-item when a label wraps around its own marker row (real column geometry)", () => {
    const rows = [
      cellRow(-1, [["PART B", 30]]),
      cellRow(0, [["1.", 27], ["Gross Salary", 58], ["Rs.", 399], ["Rs.", 512]]),
      cellRow(1, [["(a)", 30], ["Salary as per provisions contained in section 17(1)", 58], ["16439974.00", 409]]),
      // (b)'s label is split across the rows either side of it.
      cellRow(2, [["Value of perquisites under section 17(2) (as per Form No. 12BA,", 58]]),
      cellRow(3, [["(b)", 30], ["250830.00", 419]]),
      cellRow(4, [["wherever applicable)", 58]]),
      cellRow(5, [["(c)", 30], ["0.00", 444]]),
    ];

    const items = parseForm16PartB(modelOf(rows));

    expect(items.map((i) => i.marker)).toEqual(expect.arrayContaining(["1(a)", "1(b)", "1(c)"]));
    expect(items.find((i) => i.marker === "1(b)")?.amounts).toEqual([250830]);
  });

  it("parses a top-level item with label and amount on the same row", () => {
    const rows = withPartBMarker([row(0, "12. Total taxable income (9-11) 16615804.00")]);
    const items = parseForm16PartB(modelOf(rows));
    expect(items).toContainEqual({ marker: "12", label: "Total taxable income (9-11)", amounts: [16615804] });
  });

  it("parses a top-level item that's just the marker + amount, label wrapped elsewhere", () => {
    const rows = withPartBMarker([
      row(0, "Total amount of salary received from current employer"),
      row(1, "3. 1234567.00"),
    ]);
    const items = parseForm16PartB(modelOf(rows));
    expect(items).toContainEqual({ marker: "3", label: "", amounts: [1234567] });
  });

  it("qualifies a lettered sub-item with the most recent top-level item", () => {
    const rows = withPartBMarker([
      row(0, "1. Gross Salary Rs. Rs."),
      row(1, "(a) Salary as per provisions contained in section 17(1) 16439974.00"),
      row(2, "Value of perquisites under section 17(2) (as per Form No. 12BA,"),
      row(3, "(b) 250830.00"),
    ]);
    const items = parseForm16PartB(modelOf(rows));
    expect(items).toContainEqual({ marker: "1(a)", label: "Salary as per provisions contained in section 17(1)", amounts: [16439974] });
    expect(items).toContainEqual({ marker: "1(b)", label: "", amounts: [250830] });
  });

  it("captures multiple amounts on a Chapter VI-A style Gross/Qualifying/Deductible row", () => {
    const rows = withPartBMarker([row(0, "10. Deductions under Chapter VI-A"), row(1, "(k) 0.00 0.00 0.00")]);
    const items = parseForm16PartB(modelOf(rows));
    expect(items).toContainEqual({ marker: "10(k)", label: "", amounts: [0, 0, 0] });
  });

  it("finds nothing in free-flowing verification prose", () => {
    const rows = withPartBMarker([
      row(0, "I, SAMPLE SIGNATORY NAME, son / daughter of SAMPLE PARENT NAME working in the capacity of"),
    ]);
    const items = parseForm16PartB(modelOf(rows));
    expect(items).toEqual([]);
  });

  it("doesn't misread a bare decimal amount as an item marker (e.g. a wrapped '19.'/value split across rows)", () => {
    const rows = withPartBMarker([
      row(0, "19."),
      row(1, "Less: Tax deducted at source as per Form No. 12BAA submitted"),
      row(2, "0.00"),
    ]);
    const items = parseForm16PartB(modelOf(rows));
    expect(items.some((i) => i.marker === "0")).toBe(false);
  });

  it("ignores Part A's own numbered notes/legend list entirely, even though it matches the same 'N. text' shape", () => {
    // Real Form 16 Part A ends with a numbered notes list before Part B
    // starts — these must not collide with Part B's own "1."/"2." markers.
    const rows = [
      row(0, "1. Part B (Annexure) of the certificate in Form No.16 shall be issued by the employer."),
      row(1, "2. If an assessee is employed under one employer during the year..."),
      row(2, "PART B"),
      row(3, "1. Gross Salary Rs. Rs."),
      row(4, "(a) Salary as per provisions contained in section 17(1) 16439974.00"),
    ];

    const items = parseForm16PartB(modelOf(rows));

    expect(items.some((i) => i.label.includes("Annexure"))).toBe(false);
    expect(items).toContainEqual({ marker: "1(a)", label: "Salary as per provisions contained in section 17(1)", amounts: [16439974] });
  });
});
