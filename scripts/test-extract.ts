import { detectSheet, extractRows } from "../src/excel/parse";
import type { SheetRaw } from "../src/excel/types";

type Row = (string | number | null)[];
const sheet = (name: string, rows: Row[]): SheetRaw => ({ name, rows });

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++;
  console.error(`FAIL: ${label}\n   got: ${a}\n  want: ${e}`);
}

// -------- Case 1: Default schema, no header (just two columns of data) --------
{
  const s = sheet("2026-04", [
    ["HDFC", 50000],
    ["ICICI", 30000],
  ]);
  const { plan } = detectSheet(s);
  check("c1 headerRow=-1", plan.headerRow, -1);
  check("c1 valueCols=[1]", plan.valueCols, [1]);
  check("c1 extract", extractRows(s, plan), [
    { item: "HDFC", value: 50000 },
    { item: "ICICI", value: 30000 },
  ]);
}

// -------- Case 2: Header row, two columns --------
{
  const s = sheet("Apr 2026", [
    ["Item", "Value"],
    ["HDFC", 50000],
    ["ICICI", 30000],
  ]);
  const { plan } = detectSheet(s);
  check("c2 headerRow=0", plan.headerRow, 0);
  check("c2 valueCols=[1]", plan.valueCols, [1]);
  check("c2 extract", extractRows(s, plan), [
    { item: "HDFC", value: 50000 },
    { item: "ICICI", value: 30000 },
  ]);
}

// -------- Case 3: Header row, col A blank (item col empty header) --------
{
  const s = sheet("2026-04", [
    ["", "Bank balance", "Mutual Fund", "FD"],
    ["HDFC", 50000, null, null],
    ["ICICI", null, 25000, null],
    ["SBI", null, null, 100000],
  ]);
  const { plan } = detectSheet(s);
  check("c3 headerRow=0", plan.headerRow, 0);
  check("c3 valueCols", plan.valueCols, [1, 2, 3]);
  check("c3 headers", plan.valueColHeaders, ["Bank balance", "Mutual Fund", "FD"]);
  check("c3 extract", extractRows(s, plan), [
    { item: "HDFC", value: 50000 },
    { item: "ICICI", value: 25000 },
    { item: "SBI", value: 100000 },
  ]);
}

// -------- Case 4: Multi-column row, multi-value, header suffix applied --------
{
  const s = sheet("2026-04", [
    ["Item", "Savings", "Investments"],
    ["HDFC", 50000, 200000],
    ["ICICI", 30000, null],
  ]);
  const { plan } = detectSheet(s);
  check("c4 valueCols", plan.valueCols, [1, 2]);
  check("c4 extract", extractRows(s, plan), [
    { item: "HDFC – Savings", value: 50000 },
    { item: "HDFC – Investments", value: 200000 },
    { item: "ICICI", value: 30000 },
  ]);
}

// -------- Case 5: Stop on "Total" row --------
{
  const s = sheet("2026-04", [
    ["Item", "Value"],
    ["HDFC", 50000],
    ["ICICI", 30000],
    ["Total", 80000],
    ["This should be skipped", 9999],
  ]);
  const { plan } = detectSheet(s);
  check("c5 stopOnTotal", plan.stopOnTotal, true);
  check("c5 extract", extractRows(s, plan), [
    { item: "HDFC", value: 50000 },
    { item: "ICICI", value: 30000 },
  ]);
}

// -------- Case 6: Total stop case-insensitive, with whitespace --------
{
  const s = sheet("2026-04", [
    ["Item", "Value"],
    ["HDFC", 50000],
    ["  TOTAL  ", 50000],
  ]);
  const { plan } = detectSheet(s);
  check("c6 extract", extractRows(s, plan), [
    { item: "HDFC", value: 50000 },
  ]);
}

// -------- Case 7: Headers truncate at first blank --------
{
  const s = sheet("2026-04", [
    ["Item", "Bank balance", "MF", "", "Notes"],
    ["HDFC", 50000, 25000, "ignored", "n1"],
  ]);
  const { plan } = detectSheet(s);
  check("c7 valueCols stop at blank", plan.valueCols, [1, 2]);
  check("c7 extract", extractRows(s, plan), [
    { item: "HDFC – Bank balance", value: 50000 },
    { item: "HDFC – MF", value: 25000 },
  ]);
}

// -------- Case 8: Header rule: col B text → row 0 is header even if col A empty --------
{
  const s = sheet("2026-04", [
    ["", "Value"],
    ["HDFC", 50000],
  ]);
  const { plan } = detectSheet(s);
  check("c8 headerRow=0 with empty A header", plan.headerRow, 0);
  check("c8 extract", extractRows(s, plan), [{ item: "HDFC", value: 50000 }]);
}

console.log(`${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
