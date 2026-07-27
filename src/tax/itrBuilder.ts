/**
 * Build a best-effort, AY 2026-27-shaped ITR JSON (ITR-1 / ITR-2 / ITR-4) from
 * the app's stored income / deductions / payments plus a filer profile and a
 * deterministic tax computation. Advisory only: the output is meant for the
 * user to review and upload themselves — it is NOT validated against the
 * official e-filing schema (a documented future TODO).
 *
 * Field placement is the *inverse* of {@link parseItrJson} (src/tax/itrParser.ts),
 * so a built file round-trips: build → download → re-import yields the same
 * figures. That round-trip is the builder's correctness contract and its test.
 */

import type { ItrForm, TaxDeductionRow, TaxIncomeRow, TaxPaymentRow } from "@/db/tax";
import type { TaxProfile } from "@/tax/taxProfile";
import { computeTax, type Regime } from "@/tax/taxCompute";

export interface ItrBuilderInput {
  ay: string; // "2026-27"
  form: ItrForm;
  profile: TaxProfile;
  regime: Regime;
  income: TaxIncomeRow[];
  deductions: TaxDeductionRow[];
  payments: TaxPaymentRow[];
}

export interface BuiltReturn {
  json: unknown;
  /** Figures surfaced in the UI summary. */
  summary: {
    grossTotalIncome: number;
    totalDeductions: number;
    totalIncome: number;
    netTaxLiability: number;
    totalTaxesPaid: number;
    refundOrBalance: number; // >0 payable, <0 refund
  };
}

/** Map our stored Chapter VI-A section strings to the ITR JSON keys. Also
 *  doubles as the canonical section-code vocabulary for Form 16 Part B
 *  extraction (see `form16PartBMap.ts`) — one list, no drift between the two. */
export const SECTION_TO_KEY: Record<string, string> = {
  "80C": "Section80C",
  "80CCC": "Section80CCC",
  "80CCD(1)": "Section80CCDEmployeeOrSE",
  "80CCD(1B)": "Section80CCD1B",
  "80CCD(2)": "Section80CCDEmployer",
  "80D": "Section80D",
  "80DD": "Section80DD",
  "80DDB": "Section80DDB",
  "80E": "Section80E",
  "80EE": "Section80EE",
  "80EEA": "Section80EEA",
  "80EEB": "Section80EEB",
  "80G": "Section80G",
  "80GG": "Section80GG",
  "80GGA": "Section80GGA",
  "80GGC": "Section80GGC",
  "80RRB": "Section80RRB",
  "80QQB": "Section80QQB",
  "80TTA": "Section80TTA",
  "80TTB": "Section80TTB",
  "80U": "Section80U",
  "80CCH": "AnyOthSec80CCH",
};

function sumHead(income: TaxIncomeRow[], head: TaxIncomeRow["head"]): number {
  return income.filter((r) => r.head === head).reduce((a, r) => a + r.amount, 0);
}

function sumPay(payments: TaxPaymentRow[], type: TaxPaymentRow["type"]): number {
  return payments.filter((p) => p.type === type).reduce((a, p) => a + p.amount, 0);
}

/** The two-digit "2026" starting year the ITR schema uses for AssessmentYear. */
function ayStartYear(ay: string): string {
  const m = ay.match(/^(\d{4})/);
  return m ? m[1] : "2026";
}

function personalInfo(p: TaxProfile) {
  return {
    PAN: p.pan,
    Name: { FirstName: p.name },
    DOB: p.dob,
    Address: {
      ResidenceNo: p.flatDoorBlock,
      ResidenceName: p.premisesBuildingVillage,
      RoadOrStreet: p.road,
      LocalityOrArea: p.areaLocality,
      CityOrTownOrDistrict: p.city,
      StateCode: p.state,
      CountryCode: "91",
      PinCode: p.pinCode,
      EmailAddress: p.email,
      MobileNo: p.mobile,
    },
  };
}

function bankDetails(p: TaxProfile) {
  if (!p.bankAccountNumber && !p.bankIfsc) return undefined;
  return {
    BankDtls: {
      AddtnlBankDetails: [
        { IFSCCode: p.bankIfsc, BankName: "", BankAccountNo: p.bankAccountNumber, AccountType: "SB" },
      ],
    },
  };
}

/** Chapter VI-A deduction block keyed exactly as parseItrJson reads it. */
function deductionBlock(deductions: TaxDeductionRow[]): { block: Record<string, number>; total: number } {
  const block: Record<string, number> = {};
  let total = 0;
  for (const d of deductions) {
    total += d.amount;
    const key = SECTION_TO_KEY[d.section];
    if (key) block[key] = (block[key] ?? 0) + d.amount;
  }
  block.TotalChapVIADeductions = total;
  return { block, total };
}

function tdsSalaryArray(payments: TaxPaymentRow[]) {
  return payments
    .filter((p) => p.type === "tds_salary")
    .map((p) => ({
      EmployerOrDeductorOrCollectDetl: { EmployerOrDeductorOrCollecterName: p.payer_name ?? "", TAN: "" },
      TotalTDSSal: p.amount,
    }));
}

function tdsOtherArray(payments: TaxPaymentRow[]) {
  return payments
    .filter((p) => p.type === "tds_other")
    .map((p) => ({
      EmployerOrDeductorOrCollectDetl: { EmployerOrDeductorOrCollecterName: p.payer_name ?? "", TAN: "" },
      TaxDeducted: p.amount,
      TaxDeductCreditDtls: { TaxClaimedTDS: p.amount },
    }));
}

function tcsArray(payments: TaxPaymentRow[]) {
  return payments
    .filter((p) => p.type === "tcs")
    .map((p) => ({
      CollectedDetl: { CollectorName: p.payer_name ?? "" },
      AmtTCSClaimedThisYear: p.amount,
    }));
}

function taxPaymentArray(payments: TaxPaymentRow[]) {
  const out: { Amt: number; MajorHead: string }[] = [];
  for (const p of payments.filter((x) => x.type === "advance")) out.push({ Amt: p.amount, MajorHead: "Advance Tax" });
  for (const p of payments.filter((x) => x.type === "self_assessment")) out.push({ Amt: p.amount, MajorHead: "Self Assessment Tax" });
  return out;
}

export function buildItrJson(input: ItrBuilderInput): BuiltReturn {
  const { form, profile, regime, income, deductions, payments } = input;

  const salary = sumHead(income, "salary");
  const hp = sumHead(income, "house_property");
  // ITR JSON has no separate dividend field (see parseItrJson's IncFromOS.TotIncFromOS,
  // a single total) — dividend rolls into the same "Other Sources" total other_sources does.
  const oth = sumHead(income, "other_sources") + sumHead(income, "dividend");
  const cgShort = sumHead(income, "cg_short");
  const cgLong = sumHead(income, "cg_long");
  const business = sumHead(income, "business");
  const exempt = sumHead(income, "exempt");

  const grossTotalIncome = salary + hp + oth + cgShort + cgLong + business;
  const { block: dedBlock, total: totalDeductions } = deductionBlock(deductions);
  const totalIncome = Math.max(0, grossTotalIncome - totalDeductions);

  const tc = computeTax(totalIncome, regime);
  const netTaxLiability = tc.totalTax;

  const totalTaxesPaid =
    sumPay(payments, "tds_salary") + sumPay(payments, "tds_other") +
    sumPay(payments, "advance") + sumPay(payments, "self_assessment") + sumPay(payments, "tcs");

  const balancePayable = Math.max(0, netTaxLiability - totalTaxesPaid);
  const refundDue = Math.max(0, totalTaxesPaid - netTaxLiability);
  const refundOrBalance = balancePayable > 0 ? balancePayable : -refundDue;

  const creationInfo = {
    SWVersionNo: "1.0",
    SWCreatedBy: "myFinance",
    JSONCreatedBy: "myFinance",
    JSONCreationDate: new Date().toISOString().slice(0, 10),
    IntermediaryCity: profile.city || "NA",
    Digest: "-",
  };
  const filingStatus = { ReturnFileSec: 11, OptOutNewTaxRegime: regime === "old" ? "Y" : "N" };
  const verification = { Declaration: { AssesseeVerName: profile.name, AssesseeVerPAN: profile.pan }, Capacity: "S" };
  const bank = bankDetails(profile);
  const refundNode = { RefundDue: refundDue, BankAccountDtls: bank?.BankDtls };

  const tdsSal = tdsSalaryArray(payments);
  const tdsOth = tdsOtherArray(payments);
  const tcs = tcsArray(payments);
  const taxPay = taxPaymentArray(payments);

  const tdsSchedules: Record<string, unknown> = {};
  if (tdsSal.length) tdsSchedules.TDSonSalaries = { TDSonSalary: tdsSal };
  if (tdsOth.length) tdsSchedules.TDSonOthThanSals = { TDSOthThanSalaryDtls: tdsOth };
  if (tcs.length) tdsSchedules.ScheduleTCS = { TCS: tcs };
  if (taxPay.length) tdsSchedules.TaxPayments = { TaxPayment: taxPay };

  const taxPaidNode = {
    TaxesPaid: {
      TDS: sumPay(payments, "tds_salary") + sumPay(payments, "tds_other"),
      TCS: sumPay(payments, "tcs"),
      AdvanceTax: sumPay(payments, "advance"),
      SelfAssessmentTax: sumPay(payments, "self_assessment"),
      TotalTaxesPaid: totalTaxesPaid,
    },
    BalTaxPayable: balancePayable,
  };

  const taxComputationNode = {
    GrossTaxLiability: tc.taxAfterRebate + tc.surcharge,
    Rebate87A: tc.rebate87A,
    Surcharge: tc.surcharge,
    EducationCess: tc.cess,
    HealthEduCess: tc.cess,
    TotalTaxPayable: tc.taxAfterRebate + tc.surcharge + tc.cess,
    NetTaxLiability: netTaxLiability,
  };

  let root: Record<string, unknown>;
  const startYear = ayStartYear(input.ay);

  if (form === "1") {
    root = {
      CreationInfo: creationInfo,
      Form_ITR1: { FormName: "ITR1", AssessmentYear: startYear, SchemaVer: "Ver1.0", FormVer: "Ver1.0" },
      PersonalInfo: personalInfo(profile),
      FilingStatus: filingStatus,
      ITR1_IncomeDeductions: {
        IncomeFromSal: salary,
        TotalIncomeChargeableUnHP: hp,
        IncomeOthSrc: oth,
        ExemptIncAgriOthUs10: exempt,
        GrossTotIncome: grossTotalIncome,
        DeductUndChapVIA: dedBlock,
        TotalIncome: totalIncome,
      },
      ITR1_TaxComputation: taxComputationNode,
      TaxPaid: taxPaidNode,
      Refund: refundNode,
      ...tdsSchedules,
      Verification: verification,
    };
  } else if (form === "4") {
    root = {
      CreationInfo: creationInfo,
      Form_ITR4: { FormName: "ITR4", AssessmentYear: startYear, SchemaVer: "Ver1.0", FormVer: "Ver1.0" },
      PersonalInfo: personalInfo(profile),
      FilingStatus: filingStatus,
      IncomeDeductions: {
        IncomeFromSal: salary,
        TotalIncomeChargeableUnHP: hp,
        IncomeOthSrc: oth,
        IncomeFromBusinessProf: business,
        GrossTotIncome: grossTotalIncome,
        DeductUndChapVIA: dedBlock,
        TotalIncome: totalIncome,
      },
      ScheduleBP: { PersumptiveInc44AD: business },
      TaxComputation: taxComputationNode,
      TaxPaid: taxPaidNode,
      Refund: refundNode,
      ...tdsSchedules,
      Verification: verification,
    };
  } else {
    // ITR-2 (and ITR-3 falls back to a 2-shaped file since we don't model biz books).
    root = {
      CreationInfo: creationInfo,
      Form_ITR2: { FormName: "ITR2", AssessmentYear: startYear, SchemaVer: "Ver1.0", FormVer: "Ver1.0" },
      PartA_GEN1: { PersonalInfo: personalInfo(profile), FilingStatus: filingStatus },
      PersonalInfo: personalInfo(profile),
      FilingStatus: filingStatus,
      "PartB-TI": {
        Salaries: salary,
        IncomeFromHP: hp,
        IncFromOS: { TotIncFromOS: oth },
        CapGain: {
          ShortTerm: { TotalShortTerm: cgShort },
          LongTerm: { TotalLongTerm: cgLong },
        },
        GrossTotalIncome: grossTotalIncome,
        DeductionsUnderScheduleVIA: totalDeductions,
        TotalIncome: totalIncome,
      },
      ScheduleCGFor23: { ShortTermCapGainFor23: cgShort, LongTermCapGain23: cgLong },
      ScheduleVIA: { DeductUndChapVIA: dedBlock },
      PartB_TTI: {
        ComputationOfTaxLiability: taxComputationNode,
        HealthEduCess: tc.cess,
        TaxPaid: taxPaidNode,
        Refund: refundNode,
      },
      ...tdsSchedules,
      Verification: verification,
    };
  }

  const key = `ITR${form}`;
  return {
    json: { ITR: { [key]: root } },
    summary: {
      grossTotalIncome,
      totalDeductions,
      totalIncome,
      netTaxLiability,
      totalTaxesPaid,
      refundOrBalance,
    },
  };
}
