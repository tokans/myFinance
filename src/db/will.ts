import { query, exec, T } from "./client";

export interface WillMeta {
  id: 1;
  has_will: number;
  executor_person_id: number | null;
  guardian_person_id: number | null;
  registered: number;
  registration_details: string | null;
  location_of_original: string | null;
  probate_required: number;
  notes: string | null;
  updated_at: string;
}

export interface WillMetaInput {
  has_will?: boolean;
  executor_person_id?: number | null;
  guardian_person_id?: number | null;
  registered?: boolean;
  registration_details?: string | null;
  location_of_original?: string | null;
  probate_required?: boolean;
  notes?: string | null;
}

export async function getWillMeta(): Promise<WillMeta | null> {
  const rows = await query<WillMeta>(`SELECT * FROM ${T.willMeta} WHERE id = 1`);
  return rows[0] ?? null;
}

export async function upsertWillMeta(input: WillMetaInput): Promise<void> {
  await exec(
    `INSERT INTO ${T.willMeta}
       (id, has_will, executor_person_id, guardian_person_id, registered, registration_details,
        location_of_original, probate_required, notes, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       has_will = excluded.has_will,
       executor_person_id = excluded.executor_person_id,
       guardian_person_id = excluded.guardian_person_id,
       registered = excluded.registered,
       registration_details = excluded.registration_details,
       location_of_original = excluded.location_of_original,
       probate_required = excluded.probate_required,
       notes = excluded.notes,
       updated_at = datetime('now')`,
    [
      input.has_will ? 1 : 0,
      input.executor_person_id ?? null,
      input.guardian_person_id ?? null,
      input.registered ? 1 : 0,
      input.registration_details?.trim() || null,
      input.location_of_original?.trim() || null,
      input.probate_required ? 1 : 0,
      input.notes?.trim() || null,
    ],
  );
}

/** Delete the (single) Will metadata row. */
export async function clearWillMeta(): Promise<void> {
  await exec(`DELETE FROM ${T.willMeta}`);
}
