import { query, exec, getDb, T } from "./client";

/**
 * Progressive-access tier for a person (Feature 9):
 * - 0 — always-visible emergency contact (ICE / hospitalisation file)
 * - 1 — summary access (asset totals, no sensitive numbers)
 * - 2 — full access (register, Will location, vault keys) once triggered
 */
export type AccessTier = 0 | 1 | 2;

export interface Person {
  id: number;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  id_proof_ref: string | null;
  access_tier: AccessTier;
  notes: string | null;
  created_at: string;
}

export interface PersonInput {
  name: string;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
  id_proof_ref?: string | null;
  access_tier?: AccessTier;
  notes?: string | null;
}

export async function listPeople(): Promise<Person[]> {
  return query<Person>(`SELECT * FROM ${T.people} ORDER BY name COLLATE NOCASE`);
}

export async function getPerson(id: number): Promise<Person | null> {
  const rows = await query<Person>(`SELECT * FROM ${T.people} WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export async function createPerson(input: PersonInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO ${T.people} (name, relationship, phone, email, id_proof_ref, access_tier, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.relationship?.trim() || null,
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.id_proof_ref?.trim() || null,
      input.access_tier ?? 0,
      input.notes?.trim() || null,
    ],
  );
  return Number(result.lastInsertId);
}

export async function updatePerson(id: number, input: PersonInput): Promise<void> {
  await exec(
    `UPDATE ${T.people}
        SET name = ?, relationship = ?, phone = ?, email = ?, id_proof_ref = ?, access_tier = ?, notes = ?
      WHERE id = ?`,
    [
      input.name.trim(),
      input.relationship?.trim() || null,
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.id_proof_ref?.trim() || null,
      input.access_tier ?? 0,
      input.notes?.trim() || null,
      id,
    ],
  );
}

export async function deletePerson(id: number): Promise<void> {
  // documents.person_id is ON DELETE SET NULL, so attachments survive the person.
  await exec(`DELETE FROM ${T.people} WHERE id = ?`, [id]);
}

export async function countPeople(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.people}`);
  return rows[0]?.n ?? 0;
}

/** Delete every person. Callers should clear people-referencing rows first. */
export async function clearAllPeople(): Promise<void> {
  await exec(`DELETE FROM ${T.people}`);
}
