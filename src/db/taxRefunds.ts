import { query, exec, T } from "./client";

export interface TaxRefundRow {
  id: number;
  ay: string;
  amount: number;
  mode: string | null;
  refund_date: string | null;
  source_path: string | null;
  note: string | null;
}

export async function listRefundsForAy(ay: string): Promise<TaxRefundRow[]> {
  return query<TaxRefundRow>(`SELECT * FROM ${T.taxRefunds} WHERE ay = ? ORDER BY id`, [ay]);
}

/** All refund rows across every assessment year — for the reconciliation screen. */
export async function listAllRefunds(): Promise<TaxRefundRow[]> {
  return query<TaxRefundRow>(`SELECT * FROM ${T.taxRefunds} ORDER BY ay DESC, id`);
}

/**
 * Replaces only this AY's refund rows sourced from `sourcePrefix` (same
 * prefix-scoped replace as `clearRowsBySourcePrefix` in `db/tax.ts`) — unlike
 * `ais_sft`, refunds can legitimately come from more than one producer (AIS
 * PDF and TIS PDF both carry a Part B4), so a re-import must not clobber the
 * other importer's rows for the same AY. The prefixes in use ("AIS-PDF",
 * "TIS-PDF") contain no LIKE metacharacters, so a plain `LIKE prefix || '%'`
 * is safe.
 */
export async function replaceRefundsForAy(
  ay: string,
  sourcePrefix: string,
  rows: Array<{ amount: number; mode: string | null; refundDate: string | null; sourcePath: string; note: string | null }>,
): Promise<void> {
  await exec(`DELETE FROM ${T.taxRefunds} WHERE ay = ? AND source_path LIKE ?`, [ay, `${sourcePrefix}%`]);
  for (const r of rows) {
    await exec(
      `INSERT INTO ${T.taxRefunds} (ay, amount, mode, refund_date, source_path, note) VALUES (?, ?, ?, ?, ?, ?)`,
      [ay, r.amount, r.mode, r.refundDate, r.sourcePath, r.note],
    );
  }
}
