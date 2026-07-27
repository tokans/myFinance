import { query, exec, T } from "./client";

export interface AisSftDbRow {
  id: number;
  ay: string;
  sft_code: string | null;
  description: string;
  reporting_entity: string | null;
  amount: number;
  date: string | null;
}

export async function listSftForAy(ay: string): Promise<AisSftDbRow[]> {
  return query<AisSftDbRow>(`SELECT * FROM ${T.aisSft} WHERE ay = ? ORDER BY id`, [ay]);
}

/** All SFT rows across every assessment year — used by the cross-check, which
 *  matches purely on amount/entity rather than a specific AY. */
export async function listAllSft(): Promise<AisSftDbRow[]> {
  return query<AisSftDbRow>(`SELECT * FROM ${T.aisSft} ORDER BY ay DESC, id`);
}

/**
 * Full replace for one AY (there's exactly one producer — the AIS import —
 * so the multi-source prefix-matching complexity `db/tax.ts` needs doesn't
 * apply here; a re-import simply supersedes the previous SFT rows for that AY).
 */
export async function replaceSftForAy(
  ay: string,
  rows: Array<{ sftCode: string; description: string; reportingEntity: string | null; amount: number; date: string | null }>,
): Promise<void> {
  await exec(`DELETE FROM ${T.aisSft} WHERE ay = ?`, [ay]);
  for (const r of rows) {
    await exec(
      `INSERT INTO ${T.aisSft} (ay, sft_code, description, reporting_entity, amount, date) VALUES (?, ?, ?, ?, ?, ?)`,
      [ay, r.sftCode || null, r.description, r.reportingEntity, r.amount, r.date],
    );
  }
}
