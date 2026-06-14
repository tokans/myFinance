import { describe, it, expect } from "vitest";
import { parseItrJson, type ParseResult } from "./itrParser";
import itr1 from "./__fixtures__/sample-ITR1.json";
import itr2 from "./__fixtures__/sample-ITR2.json";
import itr4 from "./__fixtures__/sample-ITR4.json";

/** Sum the amounts of income rows for a given head. */
function incomeOf(r: ParseResult, head: string): number {
  return r.income.filter((x) => x.head === head).reduce((s, x) => s + x.amount, 0);
}
function deductionOf(r: ParseResult, section: string): number | undefined {
  return r.deductions.find((x) => x.section === section)?.amount;
}
function paymentsOf(r: ParseResult, type: string): number {
  return r.payments.filter((x) => x.type === type).reduce((s, x) => s + x.amount, 0);
}

describe("parseItrJson — ITR-2 (the reported failure)", () => {
  const r = parseItrJson(itr2, "sample-ITR2.json");

  it("detects the form, AY and PAN from ITR-2's nested layout", () => {
    expect(r.itrForm).toBe("2");
    expect(r.ay).toBe("2026-27"); // normalized from Form_ITR2.AssessmentYear = "2026"
    expect(r.pan).toBe("AAAAA1111A"); // from PartA_GEN1.PersonalInfo.PAN
  });

  it("extracts income across PartB-TI + schedules", () => {
    expect(incomeOf(r, "salary")).toBe(1500000);
    expect(incomeOf(r, "house_property")).toBe(120000);
    expect(incomeOf(r, "other_sources")).toBe(30000);
    expect(incomeOf(r, "cg_short")).toBe(50000); // ScheduleCGFor23
    expect(incomeOf(r, "cg_long")).toBe(200000);
  });

  it("extracts Chapter VI-A deductions from ScheduleVIA, incl. the 80CCD employer key", () => {
    expect(deductionOf(r, "80C")).toBe(150000);
    expect(deductionOf(r, "80D")).toBe(25000);
    expect(deductionOf(r, "80CCD(2)")).toBe(60000); // Section80CCDEmployer — previously never matched
    expect(deductionOf(r, "80TTA")).toBe(8000);
  });

  it("extracts TDS (ScheduleTDS1/TDS2) and advance/SA tax (ScheduleIT)", () => {
    expect(paymentsOf(r, "tds_salary")).toBe(200000);
    expect(paymentsOf(r, "tds_other")).toBe(3000); // nested TaxDeductCreditDtls.TaxClaimedTDS
    // Two ScheduleIT challans, classed self-assessment (no MajorHead in ITR-2)
    expect(paymentsOf(r, "self_assessment")).toBe(100000 + 18984);
    const salPayer = r.payments.find((p) => p.type === "tds_salary")?.payer_name;
    expect(salPayer).toBe("Acme Corp Pvt Ltd");
  });

  it("extracts the assessment summary from PartB-TI + PartB_TTI", () => {
    expect(r.assessment.gross_total_income).toBe(1900000);
    expect(r.assessment.total_deductions).toBe(243000);
    expect(r.assessment.total_income).toBe(1657000);
    expect(r.assessment.rebate_87a).toBe(0);
    expect(r.assessment.education_cess).toBe(12384);
    expect(r.assessment.net_tax_liability).toBe(321984);
    expect(r.assessment.total_taxes_paid).toBe(321984);
    expect(r.assessment.refund_or_balance).toBe(0);
  });
});

describe("parseItrJson — ITR-1 (regression: must still work)", () => {
  const r = parseItrJson(itr1, "sample-ITR1.json");

  it("detects form/AY/PAN", () => {
    expect(r.itrForm).toBe("1");
    expect(r.ay).toBe("2026-27");
    expect(r.pan).toBe("BBBBB2222B");
  });

  it("extracts income (incl. negative HP loss) and exempt income", () => {
    expect(incomeOf(r, "salary")).toBe(800000);
    expect(incomeOf(r, "house_property")).toBe(-20000);
    expect(incomeOf(r, "other_sources")).toBe(15000);
    expect(incomeOf(r, "exempt")).toBe(12000);
  });

  it("extracts deductions incl. the corrected 80CCD(1) employee key", () => {
    expect(deductionOf(r, "80C")).toBe(150000);
    expect(deductionOf(r, "80CCD(1)")).toBe(40000); // Section80CCDEmployeeOrSE
    expect(deductionOf(r, "80D")).toBe(18000);
  });

  it("extracts salary TDS and assessment totals", () => {
    expect(paymentsOf(r, "tds_salary")).toBe(31096);
    expect(r.assessment.gross_total_income).toBe(795000);
    expect(r.assessment.total_deductions).toBe(213000);
    expect(r.assessment.total_income).toBe(582000);
    expect(r.assessment.net_tax_liability).toBe(31096);
    expect(r.assessment.total_taxes_paid).toBe(31096);
  });
});

describe("parseItrJson — ITR-4 (was also broken: ITR4_* keys don't exist)", () => {
  const r = parseItrJson(itr4, "sample-ITR4.json");

  it("detects form/AY/PAN", () => {
    expect(r.itrForm).toBe("4");
    expect(r.ay).toBe("2026-27");
    expect(r.pan).toBe("CCCCC3333C");
  });

  it("extracts presumptive business income from ScheduleBP + salary/other", () => {
    expect(incomeOf(r, "business")).toBe(700000);
    expect(incomeOf(r, "salary")).toBe(240000);
    expect(incomeOf(r, "other_sources")).toBe(20000);
  });

  it("extracts deductions and totals from the IncomeDeductions block", () => {
    expect(deductionOf(r, "80C")).toBe(100000);
    expect(deductionOf(r, "80D")).toBe(22000);
    expect(r.assessment.gross_total_income).toBe(960000);
    expect(r.assessment.total_income).toBe(838000);
    expect(r.assessment.net_tax_liability).toBe(81120);
  });

  it("extracts TDS (other) and ScheduleIT payments", () => {
    expect(paymentsOf(r, "tds_other")).toBe(5000);
    expect(paymentsOf(r, "self_assessment")).toBe(60000 + 16120);
  });
});

describe("parseItrJson — robustness", () => {
  it("returns an empty result (no form) for non-ITR JSON instead of throwing", () => {
    const r = parseItrJson({ foo: "bar" }, "x.json");
    expect(r.itrForm).toBeNull();
    expect(r.income).toHaveLength(0);
  });

  it("tolerates a totally empty object", () => {
    const r = parseItrJson({}, "x.json");
    expect(r.itrForm).toBeNull();
  });

  it("does not flag mapped ITR-2 schedules as unmapped", () => {
    const r = parseItrJson(itr2, "sample-ITR2.json");
    // Every top-level ITR-2 key in the fixture is known to the parser.
    expect(r.unmappedKeyCount).toBe(0);
  });
});
