import { exec, query, T } from "./client";

export type IncomeHead =
  | "salary" | "house_property" | "other_sources"
  | "cg_short" | "cg_long" | "business" | "exempt";

export type PaymentType =
  | "tds_salary" | "tds_other" | "advance" | "self_assessment" | "tcs";

export type ItrForm = "1" | "2" | "3" | "4";

export interface TaxYear {
  ay: string;
  itr_form: ItrForm | null;
  itr_form_source: "manual" | "import" | "wizard" | null;
  imported_filename: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaxIncomeRow {
  id: number;
  ay: string;
  head: IncomeHead;
  label: string;
  amount: number;
  source_path: string | null;
  note: string | null;
}

export interface TaxDeductionRow {
  id: number;
  ay: string;
  section: string;
  label: string;
  amount: number;
  source_path: string | null;
  note: string | null;
}

export interface TaxPaymentRow {
  id: number;
  ay: string;
  type: PaymentType;
  payer_name: string | null;
  amount: number;
  source_path: string | null;
  note: string | null;
}

export interface TaxAssessment {
  ay: string;
  gross_total_income: number | null;
  total_deductions: number | null;
  total_income: number | null;
  total_tax_payable: number | null;
  rebate_87a: number | null;
  education_cess: number | null;
  net_tax_liability: number | null;
  total_taxes_paid: number | null;
  refund_or_balance: number | null;
  updated_at: string;
}

export interface WizardAnswers {
  ay: string;
  answers: Record<string, unknown>;
  recommended: ItrForm | null;
  rationale: string | null;
  updated_at: string;
}

// -------- Years --------

export async function listTaxYears(): Promise<TaxYear[]> {
  return query<TaxYear>(`SELECT * FROM ${T.taxYears} ORDER BY ay DESC`);
}

export async function getTaxYear(ay: string): Promise<TaxYear | null> {
  const rows = await query<TaxYear>(`SELECT * FROM ${T.taxYears} WHERE ay = ?`, [ay]);
  return rows[0] ?? null;
}

export async function upsertTaxYear(ay: string, patch: Partial<TaxYear> = {}): Promise<void> {
  await exec(
    `INSERT INTO ${T.taxYears} (ay, itr_form, itr_form_source, imported_filename, notes)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ay) DO UPDATE SET
       itr_form           = COALESCE(excluded.itr_form, ${T.taxYears}.itr_form),
       itr_form_source    = COALESCE(excluded.itr_form_source, ${T.taxYears}.itr_form_source),
       imported_filename  = COALESCE(excluded.imported_filename, ${T.taxYears}.imported_filename),
       notes              = COALESCE(excluded.notes, ${T.taxYears}.notes),
       updated_at         = datetime('now')`,
    [ay, patch.itr_form ?? null, patch.itr_form_source ?? null, patch.imported_filename ?? null, patch.notes ?? null],
  );
}

export async function deleteTaxYear(ay: string): Promise<void> {
  await exec(`DELETE FROM ${T.taxYears} WHERE ay = ?`, [ay]);
}

/** Number of tracked assessment years. */
export async function countTaxYears(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.taxYears}`);
  return rows[0]?.n ?? 0;
}

/**
 * Delete every tax record across all assessment years — years, income,
 * deductions, payments, assessments and wizard answers.
 */
export async function clearAllTax(): Promise<void> {
  await exec(`DELETE FROM ${T.taxIncome}`);
  await exec(`DELETE FROM ${T.taxDeductions}`);
  await exec(`DELETE FROM ${T.taxPayments}`);
  await exec(`DELETE FROM ${T.taxAssessment}`);
  await exec(`DELETE FROM ${T.taxWizardAnswers}`);
  await exec(`DELETE FROM ${T.taxYears}`);
}

// -------- Income/Deductions/Payments (CRUD + bulk replace per AY) --------

export async function listIncome(ay: string): Promise<TaxIncomeRow[]> {
  return query<TaxIncomeRow>(`SELECT * FROM ${T.taxIncome} WHERE ay = ? ORDER BY id`, [ay]);
}
export async function listDeductions(ay: string): Promise<TaxDeductionRow[]> {
  return query<TaxDeductionRow>(`SELECT * FROM ${T.taxDeductions} WHERE ay = ? ORDER BY id`, [ay]);
}
export async function listPayments(ay: string): Promise<TaxPaymentRow[]> {
  return query<TaxPaymentRow>(`SELECT * FROM ${T.taxPayments} WHERE ay = ? ORDER BY id`, [ay]);
}

export async function insertIncome(row: Omit<TaxIncomeRow, "id">): Promise<void> {
  await exec(
    `INSERT INTO ${T.taxIncome} (ay, head, label, amount, source_path, note) VALUES (?, ?, ?, ?, ?, ?)`,
    [row.ay, row.head, row.label, row.amount, row.source_path, row.note],
  );
}
export async function insertDeduction(row: Omit<TaxDeductionRow, "id">): Promise<void> {
  await exec(
    `INSERT INTO ${T.taxDeductions} (ay, section, label, amount, source_path, note) VALUES (?, ?, ?, ?, ?, ?)`,
    [row.ay, row.section, row.label, row.amount, row.source_path, row.note],
  );
}
export async function insertPayment(row: Omit<TaxPaymentRow, "id">): Promise<void> {
  await exec(
    `INSERT INTO ${T.taxPayments} (ay, type, payer_name, amount, source_path, note) VALUES (?, ?, ?, ?, ?, ?)`,
    [row.ay, row.type, row.payer_name, row.amount, row.source_path, row.note],
  );
}

export async function clearImportedRows(ay: string): Promise<void> {
  await exec(`DELETE FROM ${T.taxIncome} WHERE ay = ? AND source_path IS NOT NULL`, [ay]);
  await exec(`DELETE FROM ${T.taxDeductions} WHERE ay = ? AND source_path IS NOT NULL`, [ay]);
  await exec(`DELETE FROM ${T.taxPayments} WHERE ay = ? AND source_path IS NOT NULL`, [ay]);
}

// -------- Assessment summary --------

export async function getAssessment(ay: string): Promise<TaxAssessment | null> {
  const rows = await query<TaxAssessment>(`SELECT * FROM ${T.taxAssessment} WHERE ay = ?`, [ay]);
  return rows[0] ?? null;
}

export async function upsertAssessment(a: Omit<TaxAssessment, "updated_at">): Promise<void> {
  await exec(
    `INSERT INTO ${T.taxAssessment} (
       ay, gross_total_income, total_deductions, total_income, total_tax_payable,
       rebate_87a, education_cess, net_tax_liability, total_taxes_paid, refund_or_balance, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ay) DO UPDATE SET
       gross_total_income = excluded.gross_total_income,
       total_deductions   = excluded.total_deductions,
       total_income       = excluded.total_income,
       total_tax_payable  = excluded.total_tax_payable,
       rebate_87a         = excluded.rebate_87a,
       education_cess     = excluded.education_cess,
       net_tax_liability  = excluded.net_tax_liability,
       total_taxes_paid   = excluded.total_taxes_paid,
       refund_or_balance  = excluded.refund_or_balance,
       updated_at         = datetime('now')`,
    [
      a.ay, a.gross_total_income, a.total_deductions, a.total_income, a.total_tax_payable,
      a.rebate_87a, a.education_cess, a.net_tax_liability, a.total_taxes_paid, a.refund_or_balance,
    ],
  );
}

// -------- Wizard answers --------

export async function getWizardAnswers(ay: string): Promise<WizardAnswers | null> {
  const rows = await query<{ ay: string; answers: string; recommended: string | null; rationale: string | null; updated_at: string }>(
    `SELECT * FROM ${T.taxWizardAnswers} WHERE ay = ?`, [ay],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ay: r.ay,
    answers: JSON.parse(r.answers) as Record<string, unknown>,
    recommended: (r.recommended as ItrForm | null) ?? null,
    rationale: r.rationale,
    updated_at: r.updated_at,
  };
}

export async function upsertWizardAnswers(a: { ay: string; answers: Record<string, unknown>; recommended: ItrForm | null; rationale: string | null }): Promise<void> {
  await exec(
    `INSERT INTO ${T.taxWizardAnswers} (ay, answers, recommended, rationale)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ay) DO UPDATE SET
       answers     = excluded.answers,
       recommended = excluded.recommended,
       rationale   = excluded.rationale,
       updated_at  = datetime('now')`,
    [a.ay, JSON.stringify(a.answers), a.recommended, a.rationale],
  );
}
