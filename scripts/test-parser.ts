import { parseMonthFromSheetName } from "../src/excel/parse";

type Case = [string, "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD", string | null];

const cases: Case[] = [
  ["2026-04",    "DD/MM/YYYY", "2026-04"],
  ["2026/04",    "DD/MM/YYYY", "2026-04"],
  ["04-2026",    "DD/MM/YYYY", "2026-04"],
  ["Apr 2026",   "DD/MM/YYYY", "2026-04"],
  ["April 2026", "DD/MM/YYYY", "2026-04"],
  ["Apr-26",     "DD/MM/YYYY", "2026-04"],
  ["April 26",   "DD/MM/YYYY", "2026-04"],
  ["2026 April", "DD/MM/YYYY", "2026-04"],

  ["0426",       "DD/MM/YYYY", "2026-04"],
  ["1226",       "DD/MM/YYYY", "2026-12"],

  ["042026",     "DD/MM/YYYY", "2026-04"],
  ["202604",     "DD/MM/YYYY", "2026-04"],

  ["310326",     "DD/MM/YYYY", "2026-03"],
  ["010426",     "DD/MM/YYYY", "2026-04"],
  ["281226",     "DD/MM/YYYY", "2026-12"],

  ["31032026",   "DD/MM/YYYY", "2026-03"],
  ["01042026",   "DD/MM/YYYY", "2026-04"],

  ["20260331",   "YYYY-MM-DD", "2026-03"],
  ["20260401",   "DD/MM/YYYY", "2026-04"],

  ["Apr26",      "DD/MM/YYYY", "2026-04"],
  ["apr26",      "DD/MM/YYYY", "2026-04"],
  ["April26",    "DD/MM/YYYY", "2026-04"],
  ["Mar26",      "DD/MM/YYYY", "2026-03"],

  ["Apr2026",    "DD/MM/YYYY", "2026-04"],
  ["April2026",  "DD/MM/YYYY", "2026-04"],

  ["26Apr",      "DD/MM/YYYY", "2026-04"],

  ["2026Apr",    "DD/MM/YYYY", "2026-04"],
  ["2026apr",    "DD/MM/YYYY", "2026-04"],

  ["31-03-2026", "DD/MM/YYYY", "2026-03"],
  ["03-31-2026", "MM/DD/YYYY", "2026-03"],
  ["2026-03-31", "YYYY-MM-DD", "2026-03"],

  ["030426",     "DD/MM/YYYY", "2026-04"],
  ["030426",     "MM/DD/YYYY", "2026-03"],

  ["random",     "DD/MM/YYYY", null],
  ["",           "DD/MM/YYYY", null],
  ["13/2026",    "DD/MM/YYYY", null],
];

let pass = 0, fail = 0;
for (const [input, df, expected] of cases) {
  const got = parseMonthFromSheetName(input, df);
  if (got === expected) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: parseMonthFromSheetName(${JSON.stringify(input)}, ${df}) -> ${got}  (expected ${expected})`);
  }
}

console.log(`${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
