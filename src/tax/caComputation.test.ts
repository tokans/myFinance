import { describe, expect, it } from "vitest";
import { caComputationToRows, countCaLineItems, parseCaComputationRows } from "./caComputation";
import type { PdfTableRow } from "@/statements/types";

function row(rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: 20 })),
  };
}

/**
 * A synthetic CA computation sheet exercising every shape called out in the
 * spec: leading address/client noise (ignored), a "Statement of Income"
 * heading, a "Rs." column-header row (skipped, not read as an empty
 * section), a section with a nested subsection, a row with two amounts
 * (secondary/comparative figure), a flat (headerless) Schedule, and a
 * Schedule with its own multi-column header that should come out as a table.
 */
function buildRows(): PdfTableRow[] {
  return [
    row(0, [["Name: John Doe", 10]]),
    row(1, [["PAN: ABCDE1234F", 10]]),
    row(2, [["Statement of Income", 10]]),
    row(3, [["Particulars", 10], ["Rs.", 300]]),
    row(4, [["Income from Salary", 10]]),
    row(5, [["Basic Salary", 10], ["600000", 300]]),
    row(6, [["Perquisites", 40]]),
    row(7, [["Car allowance", 40], ["50000", 310]]),
    row(8, [["Income from Other Sources", 10]]),
    row(9, [["Interest income", 10], ["12000", 300], ["500", 310]]),
    row(10, [["Schedule VIA", 10]]),
    row(11, [["80C", 10], ["150000", 300]]),
    row(12, [["80D", 10], ["25000", 300]]),
    row(13, [["Schedule CG", 10]]),
    row(14, [["Asset", 10], ["Purchase Value", 200], ["Sale Value", 300], ["Gain", 400]]),
    row(15, [["Reliance Shares", 10], ["100000", 200], ["150000", 300], ["50000", 400]]),
    row(16, [["TCS Shares", 10], ["200000", 200], ["260000", 300], ["60000", 400]]),
  ];
}

describe("parseCaComputationRows", () => {
  it("skips leading address/client rows and the Rs. header row, and starts at Statement of Income", () => {
    const result = parseCaComputationRows(buildRows());
    expect(result.warnings).toEqual([]);
    expect(result.statementOfIncome.map((s) => s.title)).toEqual([
      "Income from Salary",
      "Income from Other Sources",
    ]);
  });

  it("puts a line item under its section, and a nested subsection's item under the subsection", () => {
    const result = parseCaComputationRows(buildRows());
    const salary = result.statementOfIncome[0];
    expect(salary.items).toEqual([{ label: "Basic Salary", amount: 600000, secondaryAmount: null }]);
    expect(salary.subsections).toEqual([
      { title: "Perquisites", items: [{ label: "Car allowance", amount: 50000, secondaryAmount: null }], subsections: [] },
    ]);
  });

  it("returns to the top level for a sibling section after a subsection closes", () => {
    const result = parseCaComputationRows(buildRows());
    const otherSources = result.statementOfIncome[1];
    expect(otherSources.subsections).toEqual([]);
  });

  it("captures a second amount on the same row as secondaryAmount, meaning left for the user to interpret", () => {
    const result = parseCaComputationRows(buildRows());
    expect(result.statementOfIncome[1].items).toEqual([
      { label: "Interest income", amount: 12000, secondaryAmount: 500 },
    ]);
  });

  it("reads a headerless Schedule as flat label/amount items", () => {
    const result = parseCaComputationRows(buildRows());
    const via = result.schedules.find((s) => s.name === "VIA");
    expect(via?.table).toBeNull();
    expect(via?.sections).toEqual([
      {
        title: "",
        items: [
          { label: "80C", amount: 150000, secondaryAmount: null },
          { label: "80D", amount: 25000, secondaryAmount: null },
        ],
        subsections: [],
      },
    ]);
  });

  it("reads a Schedule with its own multi-column header row as a table, not flat items", () => {
    const result = parseCaComputationRows(buildRows());
    const cg = result.schedules.find((s) => s.name === "CG");
    expect(cg?.sections).toEqual([]);
    expect(cg?.table).toEqual({
      headers: ["Asset", "Purchase Value", "Sale Value", "Gain"],
      rows: [
        { Asset: "Reliance Shares", "Purchase Value": "100000", "Sale Value": "150000", Gain: "50000" },
        { Asset: "TCS Shares", "Purchase Value": "200000", "Sale Value": "260000", Gain: "60000" },
      ],
    });
  });

  it("falls back to parsing from the top and warns when no Statement of Income heading is found", () => {
    const rows = [row(0, [["Salary", 10], ["500000", 300]])];
    const result = parseCaComputationRows(rows);
    expect(result.warnings).toContain(
      'Couldn\'t find a "Statement of Income" heading — parsing from the top of the document; review carefully.',
    );
    expect(result.statementOfIncome).toEqual([
      { title: "", items: [{ label: "Salary", amount: 500000, secondaryAmount: null }], subsections: [] },
    ]);
  });
});

describe("caComputationToRows / countCaLineItems", () => {
  it("flattens sections/subsections into breadcrumb-labeled rows, folding a secondary amount into note", () => {
    const result = parseCaComputationRows(buildRows());
    const rows = caComputationToRows(result);

    expect(rows).toContainEqual({
      label: "Income from Salary > Basic Salary",
      amount: 600000,
      sourcePath: "CACalc-PDF",
      note: null,
    });
    expect(rows).toContainEqual({
      label: "Income from Salary > Perquisites > Car allowance",
      amount: 50000,
      sourcePath: "CACalc-PDF",
      note: null,
    });
    expect(rows).toContainEqual({
      label: "Income from Other Sources > Interest income",
      amount: 12000,
      sourcePath: "CACalc-PDF",
      note: "secondary amount: 500",
    });
  });

  it("flattens a headerless schedule's items under a 'Schedule <name>' breadcrumb", () => {
    const result = parseCaComputationRows(buildRows());
    const rows = caComputationToRows(result);

    expect(rows).toContainEqual({ label: "Schedule VIA > 80C", amount: 150000, sourcePath: "CACalc-PDF", note: null });
    expect(rows).toContainEqual({ label: "Schedule VIA > 80D", amount: 25000, sourcePath: "CACalc-PDF", note: null });
  });

  it("flattens a schedule table's rows using the first parseable amount column, keeping the full row as JSON in note", () => {
    const result = parseCaComputationRows(buildRows());
    const rows = caComputationToRows(result);

    const reliance = rows.find((r) => r.label === "Schedule CG: Reliance Shares");
    expect(reliance).toEqual({
      label: "Schedule CG: Reliance Shares",
      amount: 100000,
      sourcePath: "CACalc-PDF",
      note: JSON.stringify({ Asset: "Reliance Shares", "Purchase Value": "100000", "Sale Value": "150000", Gain: "50000" }),
    });
  });

  it("counts every flattened row as one line item", () => {
    const result = parseCaComputationRows(buildRows());
    expect(countCaLineItems(result)).toBe(caComputationToRows(result).length);
    expect(countCaLineItems(result)).toBe(7); // salary, perquisite, other-sources, 80C, 80D, 2 CG rows
  });
});
