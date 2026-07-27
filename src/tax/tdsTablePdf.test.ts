import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { parseTdsDoc } from "./tdsTablePdf";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";
import type { PdfTableRow } from "@/statements/types";

/**
 * The row fixtures are transcriptions of real Form 26AS layouts (TRACES'
 * repeated two-line header, its nested per-transaction sub-table, Part-VI's
 * look-alike collector rows). They are kept verbatim through the migration to
 * the DocModel pipeline so a structuring regression surfaces here.
 */
function buildModel(rows: PdfTableRow[]) {
  return buildDocModel(
    { doc: fromNativeRows(rows), filename: "fixture.pdf", kind: "pdf" },
    { parseNumber: parseAmount, parseDate: parseStatementDate },
  );
}

function parseTdsTable(rows: PdfTableRow[]) {
  return parseTdsDoc(buildModel(rows));
}

function row(rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: 20 })),
  };
}

describe("parseTdsTable", () => {
  it("parses a standard deductor/TAN/amount/tax-deducted table", () => {
    const rows = [
      row(0, [
        ["Name of Deductor", 10],
        ["TAN of Deductor", 200],
        ["Total Amount Paid/Credited", 340],
        ["Total Tax Deducted", 480],
      ]),
      row(1, [
        ["ACME Corp Pvt Ltd", 10],
        ["ABCD12345E", 200],
        ["600000", 340],
        ["60000", 480],
      ]),
      row(2, [
        ["Beta Industries Ltd", 10],
        ["WXYZ98765F", 200],
        ["120000", 340],
        ["12000", 480],
      ]),
    ];

    const result = parseTdsTable(rows);

    expect(result.warnings).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      deductorName: "ACME Corp Pvt Ltd",
      tan: "ABCD12345E",
      amountPaid: 600000,
      taxDeducted: 60000,
    });
  });

  it("folds a wrapped deductor-name continuation row (no deductor, no tax figure) onto the previous row, including at a page break where the header repeats — generic column-classifier fallback path", () => {
    // TAN cells deliberately don't match the TAN shape, so the structural
    // (TAN-pattern) parse finds nothing and this exercises the generic
    // column-header fallback loop instead.
    const header = (): [string, number][] => [
      ["Name of Deductor", 10],
      ["TAN of Deductor", 200],
      ["Total Amount Paid/Credited", 340],
      ["Total Tax Deducted", 480],
    ];
    const rows = [
      row(0, header()),
      row(1, [["ACME Corp Pvt Ltd", 10], ["N/A", 200], ["600000", 340], ["60000", 480]]),
      row(2, [["(Formerly XYZ Holdings)", 70]]), // continuation, far enough from every column to not snap into one
      // Page 2 restates the header, starting a new segment.
      row(3, header()),
      row(4, [["Continued Name Suffix Ltd", 70]]), // continuation, first row of the new segment
      row(5, [["Beta Industries Ltd", 10], ["N/A", 200], ["120000", 340], ["12000", 480]]),
    ];

    const result = parseTdsTable(rows);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].deductorName).toBe("ACME Corp Pvt Ltd (Formerly XYZ Holdings) Continued Name Suffix Ltd");
    expect(result.rows[1].deductorName).toBe("Beta Industries Ltd");
  });

  it("caps how many consecutive lines fold onto a deductor's name, so an unrelated multi-line block (e.g. a restated assessee name/address block between pages) can't corrupt it indefinitely", () => {
    const header = (): [string, number][] => [
      ["Name of Deductor", 10],
      ["TAN of Deductor", 200],
      ["Total Amount Paid/Credited", 340],
      ["Total Tax Deducted", 480],
    ];
    const rows = [
      row(0, header()),
      row(1, [["ACME Corp Pvt Ltd", 10], ["N/A", 200], ["600000", 340], ["60000", 480]]),
      row(2, [["Assessee Name Line", 70]]),
      row(3, [["Assessee Address Line One", 70]]),
      row(4, [["Assessee Address Line Two", 70]]),
      row(5, [["Beta Industries Ltd", 10], ["N/A", 200], ["120000", 340], ["12000", 480]]),
    ];

    const result = parseTdsTable(rows);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].deductorName).toBe("ACME Corp Pvt Ltd Assessee Name Line Assessee Address Line One");
    expect(result.rows[1].deductorName).toBe("Beta Industries Ltd");
  });

  it("doesn't treat a row as a real deductor entry just because SOME text landed in the tax-deducted column band — it must actually parse as an amount", () => {
    const header = (): [string, number][] => [
      ["Name of Deductor", 10],
      ["TAN of Deductor", 200],
      ["Total Amount Paid/Credited", 340],
      ["Total Tax Deducted", 480],
    ];
    const rows = [
      row(0, header()),
      row(1, [["ACME Corp Pvt Ltd", 10], ["N/A", 200], ["600000", 340], ["60000", 480]]),
      row(2, [["Ref: XYZ", 485]]), // unparseable text landing near the tax-deducted column, not a number
      row(3, [["Beta Industries Ltd", 10], ["N/A", 200], ["120000", 340], ["12000", 480]]),
    ];

    const result = parseTdsTable(rows);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].deductorName).toBe("ACME Corp Pvt Ltd Ref: XYZ");
    expect(result.rows[1].deductorName).toBe("Beta Industries Ltd");
  });

  it("warns when no deductor column is found", () => {
    const rows = [row(0, [["Something else", 10]])];
    const result = parseTdsTable(rows);
    expect(result.warnings.some((w) => w.includes("column"))).toBe(true);
  });

  it("parses multiple TDS tables in one document (e.g. separate quarterly tables)", () => {
    const header = (): [string, number][] => [
      ["Name of Deductor", 10],
      ["TAN of Deductor", 200],
      ["Total Amount Paid/Credited", 340],
      ["Total Tax Deducted", 480],
    ];
    const rows = [
      row(0, header()),
      row(1, [["ACME Corp", 10], ["ABCD12345E", 200], ["600000", 340], ["60000", 480]]),
      row(2, header()), // a second table's own header (e.g. next quarter)
      row(3, [["Beta Industries", 10], ["WXYZ98765F", 200], ["120000", 340], ["12000", 480]]),
    ];

    const result = parseTdsTable(rows);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.deductorName)).toEqual(["ACME Corp", "Beta Industries"]);
  });

  it("keeps a differently-shaped table (e.g. an unrelated income section) in the model rather than dropping it, alongside successfully parsed TDS rows", () => {
    const rows = [
      row(0, [["Name of Deductor", 10], ["TAN of Deductor", 200], ["Total Tax Deducted", 480]]),
      row(1, [["ACME Corp", 10], ["ABCD12345E", 200], ["60000", 480]]),
      // An unrelated income table, positioned clearly away from every TDS
      // column (a different layout, as Part B typically is) so it isn't
      // accidentally geometry-matched into the TDS columns.
      row(2, [["Gross Salary", 80], ["Amount", 260]]),
      row(3, [["Basic Pay", 80], ["800000", 260]]),
    ];

    expect(parseTdsTable(rows).rows).toEqual([
      { deductorName: "ACME Corp", tan: "ABCD12345E", amountPaid: null, taxDeducted: 60000, transactions: [] },
    ]);

    // The unrelated table is still in the document model, so the review screen
    // shows it instead of the user silently losing a section this parser
    // doesn't understand.
    const rendered = JSON.stringify(buildModel(rows));
    expect(rendered).toContain("Gross Salary");
    expect(rendered).toContain("800000");
  });

  it("reads deductor summary rows structurally (by TAN shape) when the document repeats its header before every deductor and nests a per-transaction sub-table underneath — TRACES' real Form 26AS PDF layout", () => {
    // Mirrors the real export's shape: the top-level header repeats before
    // EVERY deductor and wraps across two physical lines, its own trailing
    // labels ("TAN of Deductor" / "Total Amount Paid..." / "Total Tax
    // Deducted...") are spaced tightly enough to have already merged into
    // one cell by the time table reconstruction sees them, and each
    // deductor's summary row is immediately followed by a NESTED
    // per-transaction breakup table whose own header uses overlapping
    // wording ("Amount Paid" / "Tax Deducted", no "Total" prefix) — a
    // generic column-header classifier finds both headers "valid" and
    // misaligns the nested detail rows. None of that should stop the
    // deductor summary rows (which have all the totals in one row already)
    // from being read correctly, and the nested detail rows shouldn't be
    // double-counted as extra deductors.
    const rows = [
      row(0, [
        ["Sr. No.", 10],
        ["Name of Deductor", 100],
        ["TAN of Deductor Total Amount Paid/ Total Tax Deducted #", 200], // merged, as in the real export
        ["Total TDS", 500],
      ]),
      row(1, [["Credited", 350], ["Deposited", 520]]),
      row(2, [["1", 10], ["Dummy Employer One", 100], ["AAAA11111A", 300], ["1000.00", 400], ["100.00", 460], ["50.00", 520]]),
      row(3, [
        ["Sr. No. Section", 10],
        ["Transaction Date Status of Booking Date of Booking", 100],
        ["Remarks", 300],
        ["Amount Paid /", 370],
        ["Tax Deducted ##", 430],
        ["TDS Deposited", 500],
      ]),
      row(4, [["Credited", 380], ["Deposited", 520]]),
      row(5, [
        ["1", 20], ["194", 60], ["01-Apr-2025", 110], ["F", 190], ["01-May-2025", 240],
        ["-", 320], ["1000.00", 400], ["100.00", 460], ["50.00", 520],
      ]),
      // Header repeats for the second deductor.
      row(6, [
        ["Sr. No.", 10],
        ["Name of Deductor", 100],
        ["TAN of Deductor Total Amount Paid/ Total Tax Deducted #", 200],
        ["Total TDS", 500],
      ]),
      row(7, [["Credited", 350], ["Deposited", 520]]),
      row(8, [["2", 10], ["Dummy Employer Two", 100], ["BBBB22222B", 300], ["2000.00", 400], ["200.00", 460], ["75.00", 520]]),
    ];

    const result = parseTdsTable(rows);

    expect(result.rows).toEqual([
      {
        deductorName: "Dummy Employer One",
        tan: "AAAA11111A",
        amountPaid: 1000,
        taxDeducted: 100,
        transactions: [
          { section: "194", transactionDate: "2025-04-01", dateOfBooking: "2025-05-01", status: "F", amountPaid: 1000, taxDeducted: 100 },
        ],
      },
      { deductorName: "Dummy Employer Two", tan: "BBBB22222B", amountPaid: 2000, taxDeducted: 200, transactions: [] },
    ]);
  });

  it("nests multiple per-transaction detail rows under the same deductor (e.g. several quarters/sections reported for one deductor)", () => {
    const rows = [
      // The summary header TRACES prints before every deductor. Present here
      // because the real export always prints it, and the nesting under test
      // is precisely "sub-table beneath a row OF that table".
      row(0, [
        ["Sr. No.", 10],
        ["Name of Deductor", 100],
        ["TAN of Deductor Total Amount Paid/ Total Tax Deducted #", 200],
        ["Total TDS", 500],
      ]),
      row(1, [["1", 10], ["Dummy Employer", 100], ["AAAA11111A", 300], ["3000.00", 400], ["300.00", 460], ["150.00", 520]]),
      row(2, [
        ["Sr. No. Section", 10],
        ["Transaction Date Status of Booking Date of Booking", 100],
        ["Remarks", 300],
        ["Amount Paid /", 370],
        ["Tax Deducted ##", 430],
        ["TDS Deposited", 500],
      ]),
      row(3, [
        ["1", 20], ["192", 60], ["01-Apr-2025", 110], ["F", 190], ["01-May-2025", 240],
        ["-", 320], ["1000.00", 400], ["100.00", 460], ["50.00", 520],
      ]),
      row(4, [
        ["2", 20], ["194A", 60], ["01-Jul-2025", 110], ["F", 190], ["01-Aug-2025", 240],
        ["-", 320], ["2000.00", 400], ["200.00", 460], ["100.00", 520],
      ]),
    ];

    const result = parseTdsTable(rows);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].transactions).toEqual([
      { section: "192", transactionDate: "2025-04-01", dateOfBooking: "2025-05-01", status: "F", amountPaid: 1000, taxDeducted: 100 },
      { section: "194A", transactionDate: "2025-07-01", dateOfBooking: "2025-08-01", status: "F", amountPaid: 2000, taxDeducted: 200 },
    ]);
  });

  it("doesn't mix a later section's TAN-shaped rows (e.g. Part-VI's Tax Collected at Source) into Part-I's Tax Deducted list", () => {
    // 26AS has several other parts that repeat the exact same "TAN-shaped
    // token + trailing amounts" row shape for a different concept entirely —
    // most notably Part-VI's tax-COLLECTED-at-source collector rows, which
    // look structurally identical to a Part-I deductor row. Those must stay
    // out of the TDS (tax-DEDUCTED) result even though they'd otherwise match.
    const rows = [
      row(0, [["PART-I - Details of Tax Deducted at Source", 10]]),
      row(1, [
        ["Sr. No.", 10], ["Name of Deductor", 100],
        ["TAN of Deductor Total Amount Paid/ Total Tax Deducted #", 200], ["Total TDS", 500],
      ]),
      row(2, [["1", 10], ["Dummy Employer One", 100], ["AAAA11111A", 300], ["1000.00", 400], ["100.00", 460], ["50.00", 520]]),
      row(3, [["PART-VI-Details of Tax Collected at Source", 10]]),
      row(4, [
        ["Sr. No.", 10], ["Name of Collector", 100],
        ["TAN of Collector Total Amount Paid/ Total Tax Collected +", 200], ["Total TCS", 500],
      ]),
      row(5, [["1", 10], ["Dummy Collector One", 100], ["ZZZZ99999Z", 300], ["5000.00", 400], ["500.00", 460], ["25.00", 520]]),
    ];

    const result = parseTdsTable(rows);

    expect(result.rows).toEqual([{ deductorName: "Dummy Employer One", tan: "AAAA11111A", amountPaid: 1000, taxDeducted: 100, transactions: [] }]);
    expect(result.rows.some((r) => r.tan === "ZZZZ99999Z")).toBe(false);
  });
});
