// Generates a set of demo workbooks under sample-data/ that exercise every
// branch of the Excel import pipeline (src/excel/*). Useful for manual QA and
// for screen-recording demos.
//
// Run with:  node scripts/build-sample-data.mjs
//
// Each file targets a specific feature — see sample-data/README.md (also written
// by this script) for the mapping of file → feature.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "sample-data");
mkdirSync(OUT_DIR, { recursive: true });

// Fixed month window so output is deterministic (Nov 2025 → Apr 2026).
const MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"];

/** aoa → worksheet with column widths. */
function sheet(aoa, cols = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 36 }]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols;
  return ws;
}

/** Put a real SUM formula in the Total row's value column so formula-detection fires. */
function addSumFormula(ws, valueColLetter, firstDataRow, lastDataRow, totalRow) {
  ws[`${valueColLetter}${totalRow}`] = {
    t: "n",
    f: `SUM(${valueColLetter}${firstDataRow}:${valueColLetter}${lastDataRow})`,
  };
}

function writeWorkbook(filename, build) {
  const wb = XLSX.utils.book_new();
  build(wb);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  const path = join(OUT_DIR, filename);
  writeFileSync(path, buf);
  console.log(`wrote ${filename}  (${buf.length.toLocaleString()} bytes, ${wb.SheetNames.length} sheet(s))`);
}

// ---------------------------------------------------------------------------
// 1. Basic net-worth workbook — the canonical "default schema".
//    One sheet per month, Item | Value, Total row with a SUM formula.
//    Exercises: clean auto-detect, cross-sheet formula pattern, account-type
//    inference across nearly every type, asset/liability split, trend math.
// ---------------------------------------------------------------------------
function buildBasic(wb) {
  // Each item grows (or shrinks, for the loan) month over month.
  // [name, startingValue, monthlyDelta]
  const items = [
    ["HDFC Savings", 240000, 6000],
    ["ICICI Salary Account", 85000, 4000],
    ["Cash Wallet", 12000, -500],
    ["SBI Fixed Deposit", 500000, 0],
    ["Axis Recurring Deposit", 60000, 5000],
    ["PPF", 820000, 4500],
    ["EPF", 1150000, 12000],
    ["NPS Tier 1", 430000, 9000],
    ["Reliance Industries Stocks", 310000, 8000],
    ["Parag Parikh Flexi Cap Mutual Fund", 540000, 15000],
    ["Nippon Nifty 50 ETF", 220000, 6000],
    ["Sovereign Gold Bond", 180000, 3000],
    ["Pune Apartment (Real Estate)", 6500000, 25000],
    ["Bitcoin Crypto", 95000, 7000],
    ["HDFC Home Loan", -4200000, 28000], // liability: balance is negative, paid down each month
  ];

  MONTHS.forEach((month, mi) => {
    const aoa = [["Item", "Value"]];
    items.forEach(([name, start, delta]) => {
      // Loan: negative balance moving toward 0 as it's paid down.
      const raw = start + delta * mi;
      aoa.push([name, raw]);
    });
    aoa.push(["Total", 0]); // overwritten by SUM formula below
    const ws = sheet(aoa, [{ wch: 34 }, { wch: 16 }]);
    const totalRow = aoa.length; // 1-based A1 row of the Total line
    addSumFormula(ws, "B", 2, totalRow - 1, totalRow);
    XLSX.utils.book_append_sheet(wb, ws, month);
  });
}

// ---------------------------------------------------------------------------
// 2. Cash-flow workbook — Credit / Debit columns, no balance column.
//    Exercises: credit/debit classification from headers, running-balance
//    carry-forward (balance = previous month ± net change), oldest-first commit.
// ---------------------------------------------------------------------------
function buildCashflow(wb) {
  // [account, [m1 credit, m1 debit], [m2 ...], [m3 ...]]
  const accounts = [
    ["ICICI Salary Account", [95000, 72000], [95000, 68000], [110000, 81000]],
    ["Kotak Savings", [20000, 5000], [15000, 12000], [40000, 9000]],
    ["Cash Wallet", [10000, 9500], [10000, 8800], [12000, 11000]],
  ];
  const window = ["2026-02", "2026-03", "2026-04"];
  window.forEach((month, mi) => {
    const aoa = [["Account", "Credit (paid in)", "Debit (paid out)"]];
    accounts.forEach((row) => {
      const [credit, debit] = row[mi + 1];
      aoa.push([row[0], credit, debit]);
    });
    const ws = sheet(aoa, [{ wch: 26 }, { wch: 18 }, { wch: 18 }]);
    XLSX.utils.book_append_sheet(wb, ws, month);
  });
}

// ---------------------------------------------------------------------------
// 3. Estate-readiness workbook — Maturity / Contact / What-to-do columns.
//    Exercises: maturity-date prefill for FD rows, emergency contact + action
//    detection feeding the Emergencies page.
// ---------------------------------------------------------------------------
function buildEstate(wb) {
  const rows = [
    ["Account", "Value", "Maturity Date", "Contact", "What To Do"],
    ["SBI Fixed Deposit", 500000, "2027-03-15", "Ramesh Kumar (RM) +91 98200 11111",
      "Submit FD receipt + death certificate at SBI Koregaon Park branch to claim."],
    ["HDFC Fixed Deposit", 300000, "2026-09-01", "HDFC Branch +91 98200 22222",
      "Nominee: spouse. Auto-renews unless instructed; visit branch to break early."],
    ["LIC Endowment Insurance", 1500000, "2032-01-01", "Agent: Sunita Rao +91 98200 33333",
      "Policy docs in home safe. Call agent to file claim; needs original policy bond."],
    ["Parag Parikh Flexi Cap Mutual Fund", 540000, "", "CAMS / Zerodha Coin support",
      "Holdings on Coin (login in password manager). Nominee registered with CAMS."],
    ["Pune Apartment (Real Estate)", 6500000, "", "Lawyer: Adv. Mehta +91 98200 44444",
      "Sale deed + will in bank locker #214. Lawyer holds copy of the registered will."],
  ];
  const ws = sheet(rows, [{ wch: 36 }, { wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 52 }]);
  XLSX.utils.book_append_sheet(wb, ws, "2026-04");
}

// ---------------------------------------------------------------------------
// 4. Multi-column workbook — several value columns per row + a credit-card col.
//    Exercises: one row → multiple accounts (header appended to disambiguate),
//    credit_card column becoming a SEPARATE liability account.
// ---------------------------------------------------------------------------
function buildMultiColumn(wb) {
  const banks = [
    ["HDFC Bank", 240000, 600000, 45000],
    ["ICICI Bank", 130000, 0, 28000],
    ["Axis Bank", 90000, 250000, 0],
  ];
  ["2026-03", "2026-04"].forEach((month, mi) => {
    // Headers chosen so each classifies cleanly: "...Balance" → balance,
    // "Credit Card" → separate liability account.
    const aoa = [["Bank", "Savings Balance", "FD Balance", "Credit Card"]];
    banks.forEach(([name, sav, fd, cc]) => {
      aoa.push([name, sav + mi * 5000, fd, cc + mi * 2000]);
    });
    const ws = sheet(aoa, [{ wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }]);
    XLSX.utils.book_append_sheet(wb, ws, month);
  });
}

// ---------------------------------------------------------------------------
// 5. Needs-wizard workbook — deliberately NON-default layout.
//    Sheet name isn't a month, there are title/blank rows above the data, the
//    header sits on row 4, data starts on row 5, and there are no formulas.
//    Exercises: the manual review wizard (month picker, header-row + column-role
//    selection, "needs review" banner).
// ---------------------------------------------------------------------------
function buildNeedsWizard(wb) {
  const aoa = [
    ["My Portfolio Snapshot", null, null],          // row 1: title
    ["As exported from my broker", null, null],      // row 2: subtitle
    [null, null, null],                              // row 3: blank
    ["Instrument", "Units", "Market Value"],         // row 4: header
    ["Reliance Industries", 100, 295000],            // row 5+: data
    ["Infosys", 200, 312000],
    ["HDFC Bank", 150, 258000],
    ["Nippon Nifty 50 ETF", 800, 224000],
  ];
  const ws = sheet(aoa, [{ wch: 28 }, { wch: 10 }, { wch: 16 }]);
  XLSX.utils.book_append_sheet(wb, ws, "Holdings");
  XLSX.utils.book_append_sheet(wb, sheet([["Notes", null], ["Update monthly", null]], [{ wch: 20 }, { wch: 10 }]), "ReadMe");
}

// ---------------------------------------------------------------------------
// 6. Tutorial workbook — ONE comprehensive file that powers the full app tour.
//    Six months of history across ~12 account types (asset/liability split) in
//    the default Item | Value schema, PLUS Maturity Date / Contact / What-to-do
//    columns on the estate-relevant rows. A single import unlocks: net-worth
//    dashboard + trend, accounts, goals, FIRE (via a retirement goal added on
//    camera), the emergency/estate suite (the What-to-do column = emergency
//    actions), insurance loan-protection target (the home loan), and export.
//    Used by demo/scenarios/20-full-tutorial.ts.
// ---------------------------------------------------------------------------
function buildTutorial(wb) {
  // [name, startingValue, monthlyDelta, maturityDate?, contact?, whatToDo?]
  const items = [
    ["HDFC Savings", 240000, 6000],
    ["ICICI Salary Account", 85000, 4000],
    ["SBI Fixed Deposit", 500000, 0, "2027-03-15", "Ramesh Kumar (RM) +91 98200 11111",
      "Submit FD receipt + death certificate at SBI Koregaon Park branch to claim."],
    ["HDFC Fixed Deposit", 300000, 0, "2026-09-01", "HDFC Branch +91 98200 22222",
      "Nominee: spouse. Auto-renews unless instructed; visit branch to break early."],
    ["PPF", 820000, 4500],
    ["EPF", 1150000, 12000],
    ["NPS Tier 1", 430000, 9000],
    ["Parag Parikh Flexi Cap Mutual Fund", 540000, 15000, "", "CAMS / Zerodha Coin support",
      "Holdings on Coin (login in password manager). Nominee registered with CAMS."],
    ["Nippon Nifty 50 ETF", 220000, 6000],
    ["LIC Endowment Insurance", 1500000, 2000, "2032-01-01", "Agent: Sunita Rao +91 98200 33333",
      "Policy docs in home safe. Call agent to file claim; needs original policy bond."],
    ["Pune Apartment (Real Estate)", 6500000, 25000, "", "Lawyer: Adv. Mehta +91 98200 44444",
      "Sale deed + will in bank locker #214. Lawyer holds copy of the registered will."],
    ["HDFC Home Loan", -4200000, 28000], // liability paid down each month
  ];

  MONTHS.forEach((month, mi) => {
    const aoa = [["Item", "Value", "Maturity Date", "Contact", "What To Do"]];
    items.forEach(([name, start, delta, mat, contact, todo]) => {
      aoa.push([name, start + delta * mi, mat || "", contact || "", todo || ""]);
    });
    aoa.push(["Total", 0, "", "", ""]); // overwritten by SUM formula below
    const ws = sheet(aoa, [{ wch: 36 }, { wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 52 }]);
    const totalRow = aoa.length;
    addSumFormula(ws, "B", 2, totalRow - 1, totalRow);
    XLSX.utils.book_append_sheet(wb, ws, month);
  });
}

writeWorkbook("01-networth-basic.xlsx", buildBasic);
writeWorkbook("02-cashflow-credit-debit.xlsx", buildCashflow);
writeWorkbook("03-estate-readiness.xlsx", buildEstate);
writeWorkbook("04-multi-column-assets.xlsx", buildMultiColumn);
writeWorkbook("05-needs-wizard.xlsx", buildNeedsWizard);
writeWorkbook("06-tutorial-complete.xlsx", buildTutorial);

// README mapping each file to the feature it demonstrates.
const readme = `# Sample import data

Demo workbooks for the **Import Excel** wizard. Regenerate with:

\`\`\`bash
node scripts/build-sample-data.mjs
\`\`\`

All files use the app's default month window (Nov 2025 – Apr 2026) and dummy
Indian-finance data. Open any of them in **Apple Numbers** and re-export as
\`.numbers\` to also test the Numbers import path.

| File | Feature exercised |
|------|-------------------|
| \`01-networth-basic.xlsx\` | Canonical default schema: one sheet per month, \`Item \\| Value\`, \`Total\` row with a real \`SUM\` formula. Clean auto-detect, cross-sheet formula pattern, account-type inference across ~15 types, asset/liability split, net-worth trend. |
| \`02-cashflow-credit-debit.xlsx\` | \`Credit\` / \`Debit\` columns with **no** balance column. Header classification + running-balance carry-forward (balance = previous month ± net change), oldest-month-first commit. |
| \`03-estate-readiness.xlsx\` | \`Maturity Date\`, \`Contact\`, and \`What To Do\` columns. Maturity prefill for FD rows; emergency contact + action detection feeding the Emergencies page. |
| \`04-multi-column-assets.xlsx\` | Multiple value columns per row (\`Savings\`, \`Fixed Deposit\`) → separate accounts with the header appended; \`Credit Card\` column → separate liability account. |
| \`05-needs-wizard.xlsx\` | Deliberately non-default layout (non-month sheet name, title/blank rows, header on row 4, no formulas) to drive the manual review wizard. |
| \`06-tutorial-complete.xlsx\` | One comprehensive file for the full tutorial video: 6 months × ~12 account types (asset/liability split) in the default schema, plus \`Maturity Date\` / \`Contact\` / \`What To Do\` columns. A single import powers the whole app tour (dashboard, goals, FIRE, estate/insurance/health, export). Used by \`demo/scenarios/20-full-tutorial.ts\`. |

> All data is fictional and for testing/demo only.
`;
writeFileSync(join(OUT_DIR, "README.md"), readme);
console.log("wrote README.md");
