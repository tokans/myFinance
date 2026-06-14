// Quick smoke test of parseMonthFromSheetName.
// Run with: node scripts/test-parser.mjs
//
// Imports the TS source through esbuild-style compile-on-demand.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Use tsx for runtime TS support.
register("tsx/esm", pathToFileURL("./"));

const { parseMonthFromSheetName } = await import("../src/excel/parse.ts");

const cases = [
  // Existing separator-based
  ["2026-04",        "DD/MM/YYYY", "2026-04"],
  ["2026/04",        "DD/MM/YYYY", "2026-04"],
  ["04-2026",        "DD/MM/YYYY", "2026-04"],
  ["Apr 2026",       "DD/MM/YYYY", "2026-04"],
  ["April 2026",     "DD/MM/YYYY", "2026-04"],
  ["Apr-26",         "DD/MM/YYYY", "2026-04"],
  ["April 26",       "DD/MM/YYYY", "2026-04"],
  ["2026 April",     "DD/MM/YYYY", "2026-04"],

  // NEW: mmyy
  ["0426",           "DD/MM/YYYY", "2026-04"],
  ["1226",           "DD/MM/YYYY", "2026-12"],

  // NEW: mmyyyy
  ["042026",         "DD/MM/YYYY", "2026-04"],

  // NEW: yyyymm
  ["202604",         "DD/MM/YYYY", "2026-04"],

  // NEW: ddmmyy
  ["310326",         "DD/MM/YYYY", "2026-03"],
  ["010426",         "DD/MM/YYYY", "2026-04"],
  ["281226",         "DD/MM/YYYY", "2026-12"],

  // NEW: ddmmyyyy
  ["31032026",       "DD/MM/YYYY", "2026-03"],
  ["01042026",       "DD/MM/YYYY", "2026-04"],

  // NEW: yyyymmdd
  ["20260331",       "YYYY-MM-DD", "2026-03"],
  ["20260401",       "DD/MM/YYYY", "2026-04"],

  // NEW: MMMyy no separator
  ["Apr26",          "DD/MM/YYYY", "2026-04"],
  ["apr26",          "DD/MM/YYYY", "2026-04"],
  ["April26",        "DD/MM/YYYY", "2026-04"],
  ["Mar26",          "DD/MM/YYYY", "2026-03"],

  // NEW: MMMyyyy no separator
  ["Apr2026",        "DD/MM/YYYY", "2026-04"],
  ["April2026",      "DD/MM/YYYY", "2026-04"],

  // NEW: 26Apr (yy then alpha)
  ["26Apr",          "DD/MM/YYYY", "2026-04"],

  // NEW: 2026Apr
  ["2026Apr",        "DD/MM/YYYY", "2026-04"],
  ["2026apr",        "DD/MM/YYYY", "2026-04"],

  // NEW: triple with full year DD-MM-YYYY
  ["31-03-2026",     "DD/MM/YYYY", "2026-03"],
  ["03-31-2026",     "MM/DD/YYYY", "2026-03"],
  ["2026-03-31",     "YYYY-MM-DD", "2026-03"],

  // Date-format-dependent ambiguity
  // 03/04/26 -> DD/MM means month=4, MM/DD means month=3
  ["030426",         "DD/MM/YYYY", "2026-04"],
  ["030426",         "MM/DD/YYYY", "2026-03"],

  // Garbage
  ["random",         "DD/MM/YYYY", null],
  ["",               "DD/MM/YYYY", null],
  ["13/2026",        "DD/MM/YYYY", null],          // month=13 invalid
];

let pass = 0, fail = 0;
for (const [input, df, expected] of cases) {
  const got = parseMonthFromSheetName(input, df);
  const ok = got === expected;
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL: parseMonthFromSheetName(${JSON.stringify(input)}, ${df}) → ${got}  (expected ${expected})`);
  }
}

console.log(`${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
