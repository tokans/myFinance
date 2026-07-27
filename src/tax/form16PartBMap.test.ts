import { describe, expect, it } from "vitest";
import {
  extractChapterViaDeductions,
  extractSalaryIncome,
  form16ToDeductionRows,
  form16ToIncomeRows,
} from "./form16PartBMap";
import type { Form16PartBItem } from "./form16PartB";
import type { Form16ParseResult } from "./form16";

function item(marker: string, label: string, amounts: number[]): Form16PartBItem {
  return { marker, label, amounts };
}

function baseResult(partB: Form16PartBItem[]): Form16ParseResult {
  return {
    header: { certificateNumber: null, employerName: null, employerPan: null, tan: null, employeePan: null, assessmentYear: null },
    quarters: [],
    taxDeposits: [],
    partB,
    warnings: [],
  };
}

describe("extractSalaryIncome", () => {
  it("reads item 6's amount as the chargeable salary income", () => {
    const items = [item("6", "Income chargeable under the head Salaries (3-5)", [16165804])];
    expect(extractSalaryIncome(items)).toEqual({ amount: 16165804, warning: null });
  });

  it("accepts a blank label on item 6 (the common real-world case — label wraps elsewhere)", () => {
    const items = [item("6", "", [16165804])];
    expect(extractSalaryIncome(items)).toEqual({ amount: 16165804, warning: null });
  });

  it("refuses to guess when item 6 is missing", () => {
    const result = extractSalaryIncome([item("5", "", [50000])]);
    expect(result.amount).toBeNull();
    expect(result.warning).toMatch(/item 6/i);
  });

  it("refuses to guess when item 6's label contradicts the expected item (numbering likely drifted)", () => {
    const result = extractSalaryIncome([item("6", "Gross Salary Rs. Rs.", [16165804])]);
    expect(result.amount).toBeNull();
    expect(result.warning).toMatch(/expected/i);
  });
});

describe("extractChapterViaDeductions", () => {
  it("matches lettered sub-items under item 10 to a section code and takes the last (deductible) amount", () => {
    const items = [
      item("10", "Deductions under Chapter VI-A", []),
      item("10(a)", "Section 80C", [150000, 150000, 150000]),
      item("10(b)", "Section 80D", [25000]),
      item("11", "Aggregate of deductible amount under Chapter VI-A", [175000]),
    ];
    const result = extractChapterViaDeductions(items);
    expect(result.rows).toEqual([
      { section: "80C", label: "Section 80C", amount: 150000 },
      { section: "80D", label: "Section 80D", amount: 25000 },
    ]);
    expect(result.aggregateFromForm).toBe(175000);
    expect(result.warning).toBeNull();
  });

  it("doesn't confuse 80C with 80CCD(1B) — longer/parenthesized codes aren't swallowed by a shorter prefix", () => {
    const items = [item("10(c)", "Section 80CCD(1B) - NPS", [50000])];
    const result = extractChapterViaDeductions(items);
    expect(result.rows).toEqual([{ section: "80CCD(1B)", label: "Section 80CCD(1B) - NPS", amount: 50000 }]);
  });

  it("leaves sub-items with no recognizable section code unmatched rather than guessing", () => {
    const items = [item("10(k)", "", [0, 0, 0])];
    expect(extractChapterViaDeductions(items).rows).toEqual([]);
  });

  it("sums duplicate rows for the same section", () => {
    const items = [
      item("10(a)", "80C - LIC", [50000]),
      item("10(b)", "80C - PPF", [100000]),
    ];
    expect(extractChapterViaDeductions(items).rows).toEqual([{ section: "80C", label: "80C - LIC", amount: 150000 }]);
  });

  it("warns when the matched sum disagrees with the form's own item-11 aggregate", () => {
    const items = [
      item("10(a)", "Section 80C", [150000]),
      item("11", "Aggregate of deductible amount under Chapter VI-A", [250000]),
    ];
    const result = extractChapterViaDeductions(items);
    expect(result.warning).toMatch(/1,50,000/);
    expect(result.warning).toMatch(/2,50,000/);
  });

  it("doesn't warn when there's no item 11 to compare against", () => {
    const items = [item("10(a)", "Section 80C", [150000])];
    expect(extractChapterViaDeductions(items).warning).toBeNull();
  });
});

describe("form16ToIncomeRows / form16ToDeductionRows", () => {
  it("produces a single salary income row from item 6", () => {
    const result = baseResult([item("6", "", [16165804])]);
    const rows = form16ToIncomeRows(result, "2026-27");
    expect(rows).toEqual([
      {
        ay: "2026-27",
        head: "salary",
        label: "Salary income (Form 16 Part B item 6)",
        amount: 16165804,
        source_path: "Form16-PDF",
        note: "Income chargeable under the head \"Salaries\", per Form 16 Part B item 6.",
        excluded: false,
      },
    ]);
  });

  it("produces no income row when item 6 can't be confidently identified", () => {
    expect(form16ToIncomeRows(baseResult([]), "2026-27")).toEqual([]);
  });

  it("produces one deduction row per matched Chapter VI-A section", () => {
    const result = baseResult([item("10(a)", "Section 80C", [150000])]);
    const rows = form16ToDeductionRows(result, "2026-27");
    expect(rows).toEqual([
      {
        ay: "2026-27",
        section: "80C",
        label: "Section 80C",
        amount: 150000,
        source_path: "Form16-PDF",
        note: "Chapter VI-A deduction, per Form 16 Part B item 10 (80C).",
      },
    ]);
  });
});
