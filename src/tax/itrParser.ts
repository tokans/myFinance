/**
 * Parse an uploaded ITR JSON file (AY 2026-27 schema). Extracts the income,
 * deductions, payments and computation totals into normalized records that
 * can be written to the DB.
 *
 * Strategy: traverse defensively — every field is optional. The three ITR
 * variants we support (ITR-1, ITR-2, ITR-4) use *structurally different*
 * layouts, so each datum is resolved from a fallback chain of the canonical
 * paths across all forms:
 *   - ITR-1: a single `ITR1_IncomeDeductions` / `ITR1_TaxComputation` block,
 *     with `TDSonSalaries` / `TDSonOthThanSals` / `TaxPayments` at the root.
 *   - ITR-4: `IncomeDeductions` / `TaxComputation` (note: NOT `ITR4_*`), plus
 *     `ScheduleBP` for presumptive business income and `ScheduleIT` for taxes.
 *   - ITR-2: income spread across `PartB-TI` + per-head schedules
 *     (`ScheduleS`/`ScheduleHP`/`ScheduleCGFor23`/`ScheduleOS`), deductions in
 *     `ScheduleVIA`, taxes in `PartB_TTI`, TDS in `ScheduleTDS1`/`ScheduleTDS2`.
 *
 * Anything unrecognised at the top level is counted and surfaced so the user
 * knows their file had more in it than we mapped.
 */

import type { IncomeHead, ItrForm, PaymentType } from "@/db/tax";

export interface ParsedIncomeRow {
  head: IncomeHead;
  label: string;
  amount: number;
  source_path: string;
}

export interface ParsedDeductionRow {
  section: string;
  label: string;
  amount: number;
  source_path: string;
}

export interface ParsedPaymentRow {
  type: PaymentType;
  payer_name: string | null;
  amount: number;
  source_path: string;
}

export interface ParsedAssessment {
  gross_total_income: number | null;
  total_deductions: number | null;
  total_income: number | null;
  total_tax_payable: number | null;
  rebate_87a: number | null;
  education_cess: number | null;
  net_tax_liability: number | null;
  total_taxes_paid: number | null;
  refund_or_balance: number | null;
}

export interface ParseResult {
  itrForm: ItrForm | null;
  ay: string | null;
  pan: string | null;
  income: ParsedIncomeRow[];
  deductions: ParsedDeductionRow[];
  payments: ParsedPaymentRow[];
  assessment: ParsedAssessment;
  /** Number of nested keys we saw but didn't extract — informational. */
  unmappedKeyCount: number;
  /** Form root JSON path, e.g. 'ITR.ITR1'. */
  formRootPath: string | null;
}

// Generic JSON value type (we don't trust input shape).
type J = { [k: string]: unknown } | undefined;

/** Safe nested getter. */
function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** First non-nullish result of evaluating a list of getters. */
function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = asNumber(v);
    if (n != null) return n;
  }
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

/**
 * Assessment-year string. All AY 2026-27 forms carry it as `Form_ITRx.AssessmentYear`
 * = "2026" (the *starting* year, 4 chars). Normalize to the "2026-27" the rest of
 * the app keys on. Some older/manual files used `FilingStatus.AY` already in
 * "YYYY-YY" form — accept that verbatim.
 */
function resolveAy(root: J): string | null {
  const raw =
    asString(get(root, ["Form_ITR1", "AssessmentYear"])) ??
    asString(get(root, ["Form_ITR2", "AssessmentYear"])) ??
    asString(get(root, ["Form_ITR3", "AssessmentYear"])) ??
    asString(get(root, ["Form_ITR4", "AssessmentYear"]));
  const fsAy = asString(get(root, ["FilingStatus", "AY"]) ?? get(root, ["PartA_GEN1", "FilingStatus", "AY"]));
  const v = raw ?? fsAy;
  if (!v) return null;
  if (/^\d{4}$/.test(v)) {
    const y = Number(v);
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  }
  return v;
}

export function parseItrJson(json: unknown, filename: string): ParseResult {
  void filename;
  const result: ParseResult = {
    itrForm: null,
    ay: null,
    pan: null,
    income: [],
    deductions: [],
    payments: [],
    assessment: {
      gross_total_income: null, total_deductions: null, total_income: null,
      total_tax_payable: null, rebate_87a: null, education_cess: null,
      net_tax_liability: null, total_taxes_paid: null, refund_or_balance: null,
    },
    unmappedKeyCount: 0,
    formRootPath: null,
  };

  // Find which ITR form variant is inside the file.
  const itr = get(json, ["ITR"]) as J;
  let root: J;
  let form: ItrForm | null = null;
  let formRoot: string | null = null;
  for (const k of ["ITR1", "ITR2", "ITR3", "ITR4"] as const) {
    const v = get(itr, [k]) as J;
    if (v && typeof v === "object") {
      root = v;
      form = k.replace("ITR", "") as ItrForm;
      formRoot = `ITR.${k}`;
      break;
    }
  }
  if (!root) return result;
  result.itrForm = form;
  result.formRootPath = formRoot;

  // -------- Identity (PAN / AY) --------
  // ITR-1/ITR-4 keep PersonalInfo/FilingStatus at the root; ITR-2 nests them under PartA_GEN1.
  const personal = (get(root, ["PersonalInfo"]) ?? get(root, ["PartA_GEN1", "PersonalInfo"])) as J;
  result.pan = asString(get(personal, ["PAN"]));
  result.ay = resolveAy(root);

  // The single income/deduction block carried by ITR-1 and ITR-4 (ITR-2 has none).
  const idNode = (get(root, ["ITR1_IncomeDeductions"]) ?? get(root, ["IncomeDeductions"]) ?? get(root, ["ITR4_IncomeDeductions"]) ?? get(root, ["ITR2_IncomeDeductions"])) as J;
  // ITR-2 income totals live in PartB-TI; per-head detail in the schedules.
  const partBTI = get(root, ["PartB-TI"]) as J;

  // -------- Income --------
  // Prefer the *chargeable* salary figure (net of sec-10 exemptions / sec-16 deductions),
  // which is what flows into GTI and matches ITR-2's PartB-TI.Salaries. Gross is the last resort.
  const sal = firstNum(
    get(idNode, ["IncomeFromSal"]),
    get(partBTI, ["Salaries"]),
    get(root, ["ScheduleS", "TotIncUnderHeadSalaries"]),
    get(idNode, ["GrossSalary"]), get(root, ["ScheduleS", "TotalGrossSalary"]),
  );
  if (sal != null && sal !== 0) {
    result.income.push({ head: "salary", label: "Income from salary", amount: sal, source_path: `${formRoot}.Salaries` });
  }
  const hp = firstNum(
    get(idNode, ["TotalIncomeChargeableUnHP"]), get(idNode, ["TotIncomeOfHP"]),
    get(partBTI, ["IncomeFromHP"]),
    get(root, ["ScheduleHP", "TotalIncomeChargeableUnHP"]),
  );
  if (hp != null && hp !== 0) {
    result.income.push({ head: "house_property", label: "Income from house property", amount: hp, source_path: `${formRoot}.IncomeFromHP` });
  }
  const oth = firstNum(
    get(idNode, ["IncomeOthSrc"]), get(idNode, ["OthersInc"]),
    get(partBTI, ["IncFromOS", "TotIncFromOS"]),
    get(root, ["ScheduleOS", "TotOthSrcNoRaceHorse"]), get(root, ["ScheduleOS", "IncChargeable"]),
  );
  if (oth != null && oth !== 0) {
    result.income.push({ head: "other_sources", label: "Income from other sources", amount: oth, source_path: `${formRoot}.IncFromOS` });
  }
  const exempt = firstNum(
    get(idNode, ["ExemptIncAgriOthUs10"]),
    get(root, ["ScheduleEI", "TotalExemptInc"]),
  );
  if (exempt != null && exempt !== 0) {
    result.income.push({ head: "exempt", label: "Exempt income (sec 10 / agri)", amount: exempt, source_path: `${formRoot}.ExemptIncome` });
  }

  // Assessment totals (income side).
  result.assessment.gross_total_income = firstNum(get(idNode, ["GrossTotIncome"]), get(partBTI, ["GrossTotalIncome"]));
  result.assessment.total_deductions = firstNum(
    get(idNode, ["DeductUndChapVIA", "TotalChapVIADeductions"]),
    get(partBTI, ["DeductionsUnderScheduleVIA"]),
    get(root, ["ScheduleVIA", "DeductUndChapVIA", "TotalChapVIADeductions"]),
    get(root, ["ScheduleVIA", "UsrDeductUndChapVIA", "TotalChapVIADeductions"]),
  );
  result.assessment.total_income = firstNum(get(idNode, ["TotalIncome"]), get(partBTI, ["TotalIncome"]));

  // Capital gains: ITR-2 puts totals in ScheduleCGFor23; older/other forms used ScheduleCG.
  const cg = (get(root, ["ScheduleCG"]) ?? get(root, ["ScheduleCGFor23"])) as J;
  if (cg) {
    const st = firstNum(
      get(cg, ["ShortTermCapGainFor23"]), get(cg, ["TotalSTCG"]), get(cg, ["TotalShortTermCG"]),
      get(partBTI, ["CapGain", "ShortTerm", "TotalShortTerm"]),
    );
    if (st != null && st !== 0) {
      result.income.push({ head: "cg_short", label: "Short-term capital gains", amount: st, source_path: `${formRoot}.ScheduleCGFor23 (short)` });
    }
    const lt = firstNum(
      get(cg, ["LongTermCapGain23"]), get(cg, ["TotalLTCG"]), get(cg, ["TotalLongTermCG"]),
      get(partBTI, ["CapGain", "LongTerm", "TotalLongTerm"]),
    );
    if (lt != null && lt !== 0) {
      result.income.push({ head: "cg_long", label: "Long-term capital gains", amount: lt, source_path: `${formRoot}.ScheduleCGFor23 (long)` });
    }
  }
  // ITR-1 has a separate LTCG112A section in some years.
  const ltcg112 = get(root, ["LTCG112A"]) as J;
  if (ltcg112) {
    const amt = firstNum(get(ltcg112, ["TotalAmtTaxUsSec112A"]), get(ltcg112, ["TotLTCGUsSec112A"]));
    if (amt != null && amt !== 0) {
      result.income.push({ head: "cg_long", label: "LTCG u/s 112A", amount: amt, source_path: `${formRoot}.LTCG112A` });
    }
  }
  // ITR-4 presumptive business income (ScheduleBP), with a legacy fallback.
  const bpInc = firstNum(
    get(idNode, ["IncomeFromBusinessProf"]),
    get(root, ["ScheduleBP", "PersumptiveInc44AD"]),
    get(root, ["ScheduleBP", "PersumptiveInc44ADA"]),
    get(root, ["ScheduleBP", "PersumptiveInc44AE"]),
    get(root, ["IncomeFromBP", "TotPrsumptiveIncUs44ADetails", "IncomeBP"]),
    get(root, ["IncomeFromBP", "TotPrsumptiveIncUs44ADetails", "TotalIncomeBP"]),
  );
  if (bpInc != null && bpInc !== 0) {
    result.income.push({ head: "business", label: "Business income (presumptive)", amount: bpInc, source_path: `${formRoot}.ScheduleBP` });
  }

  // -------- Deductions (Chapter VI-A) --------
  // Source priority: user-entered table, else the computed table; in either of
  // the income block (ITR-1/4) or ScheduleVIA (ITR-2).
  const userDed = (get(idNode, ["UsrDeductUndChapVIA"]) ?? get(root, ["ScheduleVIA", "UsrDeductUndChapVIA"])) as J;
  const dedTbl = (userDed ?? get(idNode, ["DeductUndChapVIA"]) ?? get(root, ["ScheduleVIA", "DeductUndChapVIA"])) as J;
  const dedTblLabel = userDed ? "UsrDeductUndChapVIA" : "DeductUndChapVIA";
  if (dedTbl) {
    // The schema uses `Section80CCDEmployeeOrSE` / `Section80CCDEmployer` across
    // ALL three forms — never the `Section80CCD1/2` shorthand. (`80CCD1B` is its own key.)
    const sections: { key: string; section: string; label: string }[] = [
      { key: "Section80C",  section: "80C",  label: "Investments / LIC / PPF / ELSS" },
      { key: "Section80CCC", section: "80CCC", label: "Pension fund" },
      { key: "Section80CCDEmployeeOrSE", section: "80CCD(1)", label: "NPS — employee / self" },
      { key: "Section80CCD1B", section: "80CCD(1B)", label: "NPS — additional ₹50k" },
      { key: "Section80CCDEmployer", section: "80CCD(2)", label: "NPS — employer" },
      { key: "Section80D",  section: "80D",  label: "Medical insurance" },
      { key: "Section80DD", section: "80DD", label: "Dependant with disability" },
      { key: "Section80DDB", section: "80DDB", label: "Medical treatment" },
      { key: "Section80E",  section: "80E",  label: "Education loan interest" },
      { key: "Section80EE", section: "80EE", label: "Home loan interest (first-time buyer)" },
      { key: "Section80EEA", section: "80EEA", label: "Affordable home loan interest" },
      { key: "Section80EEB", section: "80EEB", label: "EV loan interest" },
      { key: "Section80G",  section: "80G",  label: "Donations" },
      { key: "Section80GG", section: "80GG", label: "Rent paid (no HRA)" },
      { key: "Section80GGA", section: "80GGA", label: "Donations for scientific research" },
      { key: "Section80GGC", section: "80GGC", label: "Donation to political party" },
      { key: "Section80RRB", section: "80RRB", label: "Royalty on patents" },
      { key: "Section80QQB", section: "80QQB", label: "Royalty — books" },
      { key: "Section80TTA", section: "80TTA", label: "Savings interest" },
      { key: "Section80TTB", section: "80TTB", label: "Senior citizen savings interest" },
      { key: "Section80U",  section: "80U",  label: "Self disability" },
      { key: "AnyOthSec80CCH", section: "80CCH", label: "Agnipath scheme" },
    ];
    for (const s of sections) {
      const amt = asNumber(get(dedTbl, [s.key]));
      if (amt != null && amt !== 0) {
        result.deductions.push({
          section: s.section, label: s.label, amount: amt,
          source_path: `${formRoot}.${dedTblLabel}.${s.key}`,
        });
      }
    }
  }

  // -------- Tax payments --------
  // TDS on salary: ITR-1 → TDSonSalaries; ITR-2 → ScheduleTDS1; both use a `TDSonSalary[]`.
  const tdsSal = (get(root, ["TDSonSalaries"]) ?? get(root, ["ScheduleTDS1"])) as J;
  if (tdsSal) {
    const arr = (get(tdsSal, ["TDSonSalary"]) as unknown[] | undefined) ?? [];
    for (const e of arr) {
      const amt = firstNum(get(e, ["TotalTDSSal"]), get(e, ["TaxDeducted"]));
      const payer = asString(get(e, ["EmployerOrDeductorOrCollectDetl", "EmployerOrDeductorOrCollecterName"]))
        ?? asString(get(e, ["EmployerOrDeductorOrCollectDetl", "TAN"]));
      if (amt != null && amt !== 0) {
        result.payments.push({ type: "tds_salary", payer_name: payer, amount: amt, source_path: `${formRoot}.TDSonSalary[]` });
      }
    }
  }
  // TDS on income other than salary: ITR-1 → TDSonOthThanSals; ITR-2 → ScheduleTDS2.
  // ITR-2's element nests the claimable amount in TaxDeductCreditDtls.
  const tdsOth = (get(root, ["TDSonOthThanSals"]) ?? get(root, ["ScheduleTDS2"])) as J;
  if (tdsOth) {
    const arr = (get(tdsOth, ["TDSOthThanSalaryDtls"]) as unknown[] | undefined) ?? [];
    for (const e of arr) {
      const amt = firstNum(
        get(e, ["TaxDeducted"]), get(e, ["TotTDSOnAmtPaid"]),
        get(e, ["TaxDeductCreditDtls", "TaxClaimedTDS"]),
        get(e, ["TaxDeductCreditDtls", "TaxClaimedOwnHands"]),
        get(e, ["TaxDeductCreditDtls", "TaxDeductedTDS"]),
      );
      const payer = asString(get(e, ["EmployerOrDeductorOrCollectDetl", "EmployerOrDeductorOrCollecterName"]))
        ?? asString(get(e, ["TDSCreditName"]))
        ?? asString(get(e, ["EmployerOrDeductorOrCollectDetl", "TAN"]))
        ?? asString(get(e, ["TANOfDeductor"]));
      if (amt != null && amt !== 0) {
        result.payments.push({ type: "tds_other", payer_name: payer, amount: amt, source_path: `${formRoot}.TDSOthThanSalaryDtls[]` });
      }
    }
  }
  // TCS (ITR-2/ITR-4 ScheduleTCS).
  const tcs = get(root, ["ScheduleTCS"]) as J;
  if (tcs) {
    const arr = (get(tcs, ["TCS"]) as unknown[] | undefined) ?? [];
    for (const e of arr) {
      const amt = firstNum(get(e, ["AmtTCSClaimedThisYear"]), get(e, ["TotalTCS"]), get(e, ["AmountTCS"]));
      const payer = asString(get(e, ["CollectedDetl", "CollectorName"])) ?? asString(get(e, ["EmployerOrDeductorOrCollectDetl", "TAN"]));
      if (amt != null && amt !== 0) {
        result.payments.push({ type: "tcs", payer_name: payer, amount: amt, source_path: `${formRoot}.ScheduleTCS.TCS[]` });
      }
    }
  }
  // Advance & self-assessment tax: ITR-1 → TaxPayments; ITR-2/ITR-4 → ScheduleIT.
  // Both use a `TaxPayment[]`. ITR-1 challans carry a MajorHead that tells advance
  // apart from self-assessment; ScheduleIT challans don't, so they default to self-assessment.
  const taxPayments = (get(root, ["TaxPayments"]) ?? get(root, ["ScheduleIT"])) as J;
  if (taxPayments) {
    const arr = (get(taxPayments, ["TaxPayment"]) as unknown[] | undefined) ?? [];
    for (const e of arr) {
      const amt = asNumber(get(e, ["Amt"]));
      const major = asString(get(e, ["MajorHead"]));
      const type: PaymentType = major === "Advance Tax" ? "advance" : "self_assessment";
      if (amt != null && amt !== 0) {
        result.payments.push({
          type, payer_name: null, amount: amt,
          source_path: `${formRoot}.TaxPayment[]`,
        });
      }
    }
  }

  // -------- Tax computation summary --------
  // ITR-1 → ITR1_TaxComputation; ITR-4 → TaxComputation; ITR-2 → PartB_TTI.ComputationOfTaxLiability.
  const tc = (get(root, ["ITR1_TaxComputation"]) ?? get(root, ["TaxComputation"]) ?? get(root, ["ITR4_TaxComputation"]) ?? get(root, ["ITR2_TaxComputation"]) ?? get(root, ["PartB_TTI", "ComputationOfTaxLiability"])) as J;
  if (tc) {
    result.assessment.total_tax_payable = firstNum(get(tc, ["TotalTaxPayable"]), get(tc, ["TaxPayableOnRebate"]), get(tc, ["GrossTaxPayable"]));
    result.assessment.rebate_87a = asNumber(get(tc, ["Rebate87A"]));
    result.assessment.education_cess = firstNum(get(tc, ["EducationCess"]), get(tc, ["HealthEduCess"]));
    result.assessment.net_tax_liability = firstNum(get(tc, ["NetTaxLiability"]), get(tc, ["AggregateTaxInterestLiability"]), get(tc, ["GrossTaxLiability"]));
  }
  // Health & education cess sits one level up in ITR-2 (PartB_TTI.HealthEduCess).
  if (result.assessment.education_cess == null) {
    result.assessment.education_cess = asNumber(get(root, ["PartB_TTI", "HealthEduCess"]));
  }

  // -------- Taxes paid / refund --------
  // ITR-1/ITR-4 → root.TaxPaid; ITR-2 → PartB_TTI.TaxPaid.
  const taxPaid = (get(root, ["TaxPaid"]) ?? get(root, ["PartB_TTI", "TaxPaid"])) as J;
  if (taxPaid) {
    result.assessment.total_taxes_paid = firstNum(
      get(taxPaid, ["TaxesPaid", "TotalTaxesPaid"]),
      get(taxPaid, ["TotalTaxesPaid"]),
    );
    const bal = asNumber(get(taxPaid, ["BalTaxPayable"]));
    if (bal != null && bal !== 0) {
      result.assessment.refund_or_balance = bal; // positive ⇒ balance still payable
    } else {
      // No balance due → surface the refund (as a negative number) if present.
      const refund = firstNum(
        get(root, ["Refund", "RefundDue"]),
        get(root, ["PartB_TTI", "Refund", "RefundDue"]),
      );
      result.assessment.refund_or_balance = refund != null && refund !== 0 ? -refund : bal;
    }
  }

  result.unmappedKeyCount = countUnmappedKeys(root);
  return result;
}

const KNOWN_TOP_KEYS = new Set<string>([
  // Shared / metadata
  "CreationInfo", "Form_ITR1", "Form_ITR2", "Form_ITR3", "Form_ITR4",
  "PersonalInfo", "FilingStatus", "PartA_GEN1",
  "Verification", "TaxReturnPreparer", "BankAccountDtls", "Refund",
  // ITR-1 / ITR-4 income+tax blocks
  "ITR1_IncomeDeductions", "ITR2_IncomeDeductions", "ITR4_IncomeDeductions", "IncomeDeductions",
  "ITR1_TaxComputation", "ITR2_TaxComputation", "ITR4_TaxComputation", "TaxComputation",
  "TaxPaid", "IncomeFromBP", "ScheduleBP", "TaxExmpIntIncDtls",
  // Deduction-supporting schedules
  "Schedule80G", "Schedule80GGA", "Schedule80GGC", "Schedule80D", "Schedule80DD",
  "Schedule80U", "Schedule80E", "Schedule80EE", "Schedule80EEA", "Schedule80EEB", "Schedule80C",
  "ScheduleVIA", "ScheduleEA10_13A",
  // Tax-paid schedules
  "TDSonSalaries", "TDSonOthThanSals", "ScheduleTDS3Dtls", "ScheduleTCS",
  "ScheduleTDS1", "ScheduleTDS2", "ScheduleTDS3", "ScheduleIT", "TaxPayments",
  // Capital gains / income heads
  "LTCG112A", "ScheduleCG", "ScheduleCGFor23", "Schedule112A", "Schedule115AD", "ScheduleVDA",
  "ScheduleS", "ScheduleHP", "ScheduleOS", "ScheduleEI", "ScheduleESOP",
  // ITR-2 computation / set-off / other schedules (seen but not individually mapped)
  "PartB-TI", "PartB_TTI",
  "ScheduleCYLA", "ScheduleBFLA", "ScheduleCFL", "ScheduleAMT", "ScheduleAMTC",
  "ScheduleSPI", "ScheduleSI", "SchedulePTI", "ScheduleFSI", "ScheduleTR1",
  "ScheduleFA", "Schedule5A2014", "ScheduleAL",
]);

function countUnmappedKeys(root: J): number {
  let n = 0;
  for (const k of Object.keys(root ?? {})) {
    if (!KNOWN_TOP_KEYS.has(k)) n++;
  }
  return n;
}
