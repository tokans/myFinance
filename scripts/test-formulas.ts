import {
  analyzeFormulas, colIndexToLetters, colLettersToIndex, extractLocalRanges, findCrossSheetPattern,
} from "../src/excel/formulas";
import { detectSheet } from "../src/excel/parse";
import type { FormulaCell, SheetRaw } from "../src/excel/types";

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++;
  console.error(`FAIL: ${label}\n   got: ${a}\n  want: ${e}`);
}

// -------- Column letter <-> index --------
check("col A=0", colLettersToIndex("A"), 0);
check("col B=1", colLettersToIndex("B"), 1);
check("col Z=25", colLettersToIndex("Z"), 25);
check("col AA=26", colLettersToIndex("AA"), 26);
check("col 0=A", colIndexToLetters(0), "A");
check("col 27=AB", colIndexToLetters(27), "AB");

// -------- extractLocalRanges --------
check("SUM range", extractLocalRanges("SUM(B2:B10)"), [
  { startRow: 1, endRow: 9, startCol: 1, endCol: 1 },
]);
check("AVG range with $", extractLocalRanges("AVERAGE($B$2:$B$10)"), [
  { startRow: 1, endRow: 9, startCol: 1, endCol: 1 },
]);
check("multi ranges", extractLocalRanges("SUM(B2:B10)+SUM(C2:C10)"), [
  { startRow: 1, endRow: 9, startCol: 1, endCol: 1 },
  { startRow: 1, endRow: 9, startCol: 2, endCol: 2 },
]);
check("cross-sheet ignored", extractLocalRanges("Sheet2!B2:B10"), []);
check("cross-sheet quoted ignored", extractLocalRanges("'My Sheet'!B2:B10"), []);
check("workbook ignored", extractLocalRanges("[file.xlsx]Sheet1!B2:B10"), []);
check("string literal ignored", extractLocalRanges("CONCAT(\"B2:B10\", A1)"), []);
check("no ranges", extractLocalRanges("A1+A2"), []);

// -------- analyzeFormulas --------
// Sheet with 3 SUM formulas across cols B,C,D all summing rows 2..10, located in row 11.
{
  const formulas: FormulaCell[] = [
    { row: 10, col: 1, formula: "SUM(B2:B10)" },
    { row: 10, col: 2, formula: "SUM(C2:C10)" },
    { row: 10, col: 3, formula: "SUM(D2:D10)" },
  ];
  const insight = analyzeFormulas(formulas);
  check("multi-col SUM insight", insight, {
    totalRow: 10,
    valueCols: [1, 2, 3],
    dataStartRow: 1,
    dataEndRow: 9,
    confidence: 1,
    formulaCount: 3,
  });
}

// Mixed: one off-pattern formula (cross-column reference) ignored.
{
  const formulas: FormulaCell[] = [
    { row: 10, col: 1, formula: "SUM(B2:B10)" },
    { row: 10, col: 2, formula: "B11+C11" }, // sideways — skipped
  ];
  const insight = analyzeFormulas(formulas);
  check("sideways formula ignored", insight?.valueCols, [1]);
}

// Empty formulas → null
check("no formulas → null", analyzeFormulas([]), null);

// Cross-sheet formula → no insight
{
  const formulas: FormulaCell[] = [
    { row: 10, col: 1, formula: "Sheet2!B2:B10" },
  ];
  check("only cross-sheet → null", analyzeFormulas(formulas), null);
}

// -------- detectSheet uses formulas --------
{
  const sheet: SheetRaw = {
    name: "2026-04",
    rows: [
      ["Item",   "Savings", "Investments"],
      ["HDFC",   50000,     200000],
      ["ICICI",  30000,     150000],
      ["SBI",    25000,     null],
      ["Total",  105000,    350000],
    ],
    formulas: [
      { row: 4, col: 1, formula: "SUM(B2:B4)" },
      { row: 4, col: 2, formula: "SUM(C2:C4)" },
    ],
  };
  const { plan } = detectSheet(sheet);
  check("detect via formulas: headerRow=0", plan.headerRow, 0);
  check("detect via formulas: itemCol=0", plan.itemCol, 0);
  check("detect via formulas: valueCols", plan.valueCols, [1, 2]);
  check("detect via formulas: dataEndRow=3", plan.dataEndRow, 3);
}

// -------- findCrossSheetPattern --------
{
  const make = (name: string): SheetRaw => ({
    name, rows: [],
    formulas: [
      { row: 10, col: 1, formula: "SUM(B2:B10)" },
      { row: 10, col: 2, formula: "SUM(C2:C10)" },
    ],
  });
  const sheets = [make("Jan-26"), make("Feb-26"), make("Mar-26")];
  const insights = Object.fromEntries(
    sheets.map((s) => [s.name, analyzeFormulas(s.formulas!)!]),
  );
  const pattern = findCrossSheetPattern(sheets, insights);
  check("pattern matchingSheets", pattern?.matchingSheets, ["Jan-26", "Feb-26", "Mar-26"]);
  check("pattern confidence=1", pattern?.confidence, 1);
}

console.log(`${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
