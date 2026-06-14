import { DEFAULT_WIZARD_INPUTS, recommendItr } from "../src/tax/recommendItr";

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`FAIL: ${label} — got ${actual}, want ${expected}`);
}

// Vanilla salaried, ₹12L → ITR-1
check("vanilla salary → 1",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 1200000 }).form, "1");

// Salaried ₹55L → ITR-2 (exceeds 50L cap)
check("salary > 50L → 2",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 5500000 }).form, "2");

// Capital gains → ITR-2
check("capital gains → 2",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 1500000, hasCapitalGains: true }).form, "2");

// Foreign assets → ITR-2 (or 3 if business)
check("foreign assets → 2",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 1500000, hasForeignAssetsOrIncome: true }).form, "2");

// Presumptive business, ₹30L → ITR-4
check("presumptive business → 4",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 3000000, hasBusinessIncome: true, hasPresumptiveOnly: true }).form, "4");

// Non-presumptive business → ITR-3
check("non-presumptive business → 3",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 3000000, hasBusinessIncome: true, hasPresumptiveOnly: false }).form, "3");

// Director → ITR-2 (or 3 if business)
check("director → 2",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 1500000, isDirector: true }).form, "2");

// Multiple houses → ITR-2
check("multiple houses → 2",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 1500000, hasMultipleHouses: true }).form, "2");

// Presumptive but >50L → ITR-3 (can't use ITR-4 due to limit, but business income → must be ITR-3)
check("presumptive but >50L → 3",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 6000000, hasBusinessIncome: true, hasPresumptiveOnly: true }).form, "3");

// Non-resident
check("non-resident salary → 2",
  recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 1500000, isResident: false }).form, "2");

console.log(`${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
