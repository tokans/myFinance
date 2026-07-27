import { query, exec, T } from "./client";

export interface TaxCaComputationRow {
  id: number;
  ay: string;
  label: string;
  amount: number;
  source_path: string | null;
  note: string | null;
}

/** A CA computation sheet's line items for one assessment year — kept
 *  strictly separate from tax_income/tax_deductions/tax_payments (see
 *  legacySchemas.ts's TaxCaComputation doc comment); read-only reference
 *  data for `tax/caReconciliation.ts`, never folded into this app's own
 *  computed figures. */
export async function listForAy(ay: string): Promise<TaxCaComputationRow[]> {
  return query<TaxCaComputationRow>(`SELECT * FROM ${T.taxCaComputation} WHERE ay = ? ORDER BY id`, [ay]);
}

/**
 * Replaces only this AY's rows sourced from `sourcePrefix` — same
 * prefix-scoped delete-then-insert as `taxRefunds.ts`'s `replaceRefundsForAy`,
 * so re-importing a CA document for the same AY doesn't accumulate
 * duplicates but also doesn't clobber a different importer's rows.
 */
export async function replaceForAy(
  ay: string,
  sourcePrefix: string,
  rows: Array<{ label: string; amount: number; sourcePath: string; note: string | null }>,
): Promise<void> {
  await exec(`DELETE FROM ${T.taxCaComputation} WHERE ay = ? AND source_path LIKE ?`, [ay, `${sourcePrefix}%`]);
  for (const r of rows) {
    await exec(
      `INSERT INTO ${T.taxCaComputation} (ay, label, amount, source_path, note) VALUES (?, ?, ?, ?, ?)`,
      [ay, r.label, r.amount, r.sourcePath, r.note],
    );
  }
}
