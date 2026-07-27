import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { FORM16_DOC_OPTIONS } from "./form16";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

import { extractForm16Header } from "./form16Header";
import type { PdfTableRow } from "@/statements/types";

function row(rowIndex: number, text: string, pageIndex = 0): PdfTableRow {
  return { page_index: pageIndex, row_index: rowIndex, cells: [{ text, x: 30, width: 500 }] };
}

/** The row fixtures are real Form 16 layouts; only the seam changed. */
function modelOf(rows: PdfTableRow[]) {
  return buildDocModel(
    { doc: fromNativeRows(rows), filename: "form16.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate, ...FORM16_DOC_OPTIONS },
  );
}

describe("extractForm16Header", () => {
  it("reads certificate number, TAN, employee PAN, and assessment year from the clean repeated per-page line", () => {
    const rows = [
      row(0, "FORM NO. 16", 0),
      row(
        0,
        "Certificate Number: ABCDEFG TAN of Employer: MUMA00001A PAN of Employee: AAAPA0000A Assessment Year: 2026-27",
        1,
      ),
    ];

    const header = extractForm16Header(modelOf(rows));

    expect(header).toMatchObject({
      certificateNumber: "ABCDEFG",
      tan: "MUMA00001A",
      employeePan: "AAAPA0000A",
      assessmentYear: "2026-27",
    });
  });

  it("tolerates missing spaces around colons and a missing certificate-number value", () => {
    const rows = [row(0, "Certificate Number: TAN of Employer:MUMA00001A Assessment Year:2026-2027")];

    const header = extractForm16Header(modelOf(rows));

    // The certificate-number value is genuinely absent on this line in real
    // documents — must not mistake the next label ("TAN") for its value.
    expect(header.certificateNumber).toBeNull();
    expect(header.tan).toBe("MUMA00001A");
    expect(header.assessmentYear).toBe("2026-2027");
  });

  it("derives the employer's PAN by excluding the already-known employee PAN from every PAN found", () => {
    const rows = [
      row(0, "AAACA0000A MUMA00001A AAAPA0000A"), // deductor PAN, TAN, employee PAN on page 1
      row(1, "PAN of Employee: AAAPA0000A", 1),
    ];

    const header = extractForm16Header(modelOf(rows));

    expect(header.employeePan).toBe("AAAPA0000A");
    expect(header.employerPan).toBe("AAACA0000A");
  });

  it("leaves employer name null (not a wrong guess) when the label row is merged with the employee column's own label", () => {
    // The real-world failure mode: the employer and employee header cells
    // merged into one blob, so stripping the employer label leaves the
    // employee column's label behind, not a real value.
    const rows = [
      row(0, "Name and address of the Employer/Specified Bank Name and address of the Employee/Specified senior citizen"),
    ];

    const header = extractForm16Header(modelOf(rows));

    expect(header.employerName).toBeNull();
  });

  it("extracts the employer name inline when label and value share a row cleanly", () => {
    const rows = [row(0, "Name of the Employer: ACME Corp Pvt Ltd")];
    const header = extractForm16Header(modelOf(rows));
    expect(header.employerName).toBe("ACME Corp Pvt Ltd");
  });

  it("finds the employer name a row below the label, by matching column x-position against the neighboring employee column", () => {
    const rows: PdfTableRow[] = [
      {
        page_index: 0,
        row_index: 0,
        cells: [
          { text: "Name and address of the Employer/Specified Bank", x: 30, width: 250 },
          { text: "Name and address of the Employee/Specified senior citizen", x: 300, width: 250 },
        ],
      },
      {
        page_index: 0,
        row_index: 1,
        cells: [
          { text: "ACME Corp Pvt Ltd", x: 30, width: 250 },
          { text: "John Doe", x: 300, width: 250 },
        ],
      },
    ];

    const header = extractForm16Header(modelOf(rows));
    expect(header.employerName).toBe("ACME Corp Pvt Ltd");
  });

  it("finds the employer name when the label sits alone on its own single-column row", () => {
    const rows = [row(0, "Name and address of the Employer/Specified Bank"), row(1, "ACME Corp Pvt Ltd")];
    const header = extractForm16Header(modelOf(rows));
    expect(header.employerName).toBe("ACME Corp Pvt Ltd");
  });

  it("gives up (null, not a wrong guess) if another field's label appears before any employer name row is found", () => {
    const rows = [row(0, "Name and address of the Employer/Specified Bank"), row(1, "PAN of the Employer")];
    const header = extractForm16Header(modelOf(rows));
    expect(header.employerName).toBeNull();
  });

  it("returns nulls (not a crash) when nothing matches", () => {
    const rows = [row(0, "unrelated text")];
    const header = extractForm16Header(modelOf(rows));
    expect(header).toEqual({
      certificateNumber: null,
      employerName: null,
      employerPan: null,
      tan: null,
      employeePan: null,
      assessmentYear: null,
    });
  });
});
