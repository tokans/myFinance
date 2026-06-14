import { query, exec, T } from "./client";

export interface IncapacityMeta {
  id: 1;
  poa_attorney_person_id: number | null;
  poa_kind: string | null;
  poa_scope: string | null;
  poa_registered: number;
  poa_revoked: number;
  amd_life_support: string | null;
  amd_resuscitation: string | null;
  amd_organ_donation: number;
  amd_attestation: string | null;
  notes: string | null;
  updated_at: string;
}

export interface IncapacityMetaInput {
  poa_attorney_person_id?: number | null;
  poa_kind?: string | null;
  poa_scope?: string | null;
  poa_registered?: boolean;
  poa_revoked?: boolean;
  amd_life_support?: string | null;
  amd_resuscitation?: string | null;
  amd_organ_donation?: boolean;
  amd_attestation?: string | null;
  notes?: string | null;
}

export async function getIncapacityMeta(): Promise<IncapacityMeta | null> {
  const rows = await query<IncapacityMeta>(`SELECT * FROM ${T.incapacityMeta} WHERE id = 1`);
  return rows[0] ?? null;
}

export async function upsertIncapacityMeta(input: IncapacityMetaInput): Promise<void> {
  await exec(
    `INSERT INTO ${T.incapacityMeta}
       (id, poa_attorney_person_id, poa_kind, poa_scope, poa_registered, poa_revoked,
        amd_life_support, amd_resuscitation, amd_organ_donation, amd_attestation, notes, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       poa_attorney_person_id = excluded.poa_attorney_person_id,
       poa_kind = excluded.poa_kind,
       poa_scope = excluded.poa_scope,
       poa_registered = excluded.poa_registered,
       poa_revoked = excluded.poa_revoked,
       amd_life_support = excluded.amd_life_support,
       amd_resuscitation = excluded.amd_resuscitation,
       amd_organ_donation = excluded.amd_organ_donation,
       amd_attestation = excluded.amd_attestation,
       notes = excluded.notes,
       updated_at = datetime('now')`,
    [
      input.poa_attorney_person_id ?? null,
      input.poa_kind?.trim() || null,
      input.poa_scope?.trim() || null,
      input.poa_registered ? 1 : 0,
      input.poa_revoked ? 1 : 0,
      input.amd_life_support?.trim() || null,
      input.amd_resuscitation?.trim() || null,
      input.amd_organ_donation ? 1 : 0,
      input.amd_attestation?.trim() || null,
      input.notes?.trim() || null,
    ],
  );
}

/** Delete the (single) incapacity (PoA / AMD) metadata row. */
export async function clearIncapacityMeta(): Promise<void> {
  await exec(`DELETE FROM ${T.incapacityMeta}`);
}
