import { query, exec, getDb, T } from "./client";
import { personKeyForLocal } from "./personSpine";

/**
 * People — SPINE-BACKED (suite hygiene finding 2.1, invariant 6).
 *
 * Identity is single-sourced on the shared `common_person` spine (display_name /
 * relationship_to_self / contact_phone / contact_email); the finance estate fields myFinance
 * OWNS (access_tier / id_proof_ref / notes) live on `myfinance_person_facet`; and
 * `myfinance_people` is a THIN link table — its historical integer `id` (the relational key
 * every estate FK joins on: holdings, will_meta, incapacity_meta, insurance claims contact,
 * access grants, documents, reminders) plus a `person_key` mapping to the spine. The app's
 * own person identity table is GONE — there is no second source of truth.
 *
 * This wrapper preserves the historical flat `Person` contract exactly (same fields, integer
 * `id`), so every estate page/domain consumer keeps working unchanged: reads JOIN link + spine
 * person + facet back into the flat shape; writes fan out to the three tables. Mirrors
 * myHealth's `profiles.ts` spine collapse.
 */

/**
 * Progressive-access tier for a person (Feature 9). Lives on the finance facet
 * (`myfinance_person_facet.access_tier`) — an estate-domain progressive-disclosure concern,
 * NOT cross-app identity — and still drives export disclosure (Health ICE Tier-0 contacts,
 * the break-glass tier ladder, FamilyPack/RegisterExport).
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

/**
 * The flat `Person` projection over the thin link (p) + spine person (pr) + finance facet (f).
 * COALESCE keeps the historical defaults (access_tier 0). The link `id` is preserved as the
 * relational key; identity comes from `common_person`, finance fields from the facet.
 */
const PERSON_SELECT = `
  SELECT
    p.id                                       AS id,
    pr.display_name                            AS name,
    pr.relationship_to_self                    AS relationship,
    pr.contact_phone                           AS phone,
    pr.contact_email                           AS email,
    f.id_proof_ref                             AS id_proof_ref,
    COALESCE(f.access_tier, 0)                 AS access_tier,
    f.notes                                    AS notes,
    p.created_at                               AS created_at
  FROM ${T.people} p
  JOIN common_person pr ON pr.person_key = p.person_key
  LEFT JOIN ${T.personFacet} f ON f.person_key = p.person_key`;

export async function listPeople(): Promise<Person[]> {
  return query<Person>(`${PERSON_SELECT} ORDER BY pr.display_name COLLATE NOCASE`);
}

export async function getPerson(id: number): Promise<Person | null> {
  const rows = await query<Person>(`${PERSON_SELECT} WHERE p.id = ?`, [id]);
  return rows[0] ?? null;
}

/**
 * Create a person: reserve the integer link id, derive a stable unique `person_key` (`mf-<id>`,
 * never a name slug — distinct people who share a name never collapse), write identity to the
 * spine + finance fields to the facet. Returns the link id (the relational key estate tables FK).
 */
export async function createPerson(input: PersonInput): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  // Reserve the integer link id first (AUTOINCREMENT) with a placeholder key, then derive the
  // stable person_key from that id and fill it in.
  const linkRes = await db.execute(
    `INSERT INTO ${T.people} (person_key, created_at) VALUES (?, ?)`,
    [`__pending__${now}`, now],
  );
  const id = Number(linkRes.lastInsertId);
  const key = personKeyForLocal(id);
  await db.execute(`UPDATE ${T.people} SET person_key = ? WHERE id = ?`, [key, id]);

  await writeIdentityAndFacet(db, key, id, input, now);
  return id;
}

export async function updatePerson(id: number, input: PersonInput): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ person_key: string }[]>(
    `SELECT person_key FROM ${T.people} WHERE id = ?`, [id],
  );
  const key = rows[0]?.person_key;
  if (!key) return;
  await writeIdentityAndFacet(db, key, id, input, new Date().toISOString());
}

/** Fan a PersonInput out to the spine identity row + the finance facet row (idempotent upsert). */
async function writeIdentityAndFacet(
  db: { execute: (sql: string, params?: unknown[]) => Promise<unknown> },
  key: string,
  id: number,
  input: PersonInput,
  now: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO common_person
       (person_key, display_name, relationship_to_self, contact_phone, contact_email, updated_at, source_app)
     VALUES (?, ?, ?, ?, ?, ?, 'myfinance')
     ON CONFLICT(person_key) DO UPDATE SET
       display_name         = excluded.display_name,
       relationship_to_self = excluded.relationship_to_self,
       contact_phone        = excluded.contact_phone,
       contact_email        = excluded.contact_email,
       updated_at           = excluded.updated_at,
       source_app           = 'myfinance'`,
    [
      key,
      input.name.trim(),
      input.relationship?.trim() || null,
      input.phone?.trim() || null,
      input.email?.trim() || null,
      now,
    ],
  );
  await db.execute(
    `INSERT INTO ${T.personFacet}
       (person_key, access_tier, id_proof_ref, notes, local_person_id, updated_at, source_app)
     VALUES (?, ?, ?, ?, ?, ?, 'myfinance')
     ON CONFLICT(person_key) DO UPDATE SET
       access_tier     = excluded.access_tier,
       id_proof_ref    = excluded.id_proof_ref,
       notes           = excluded.notes,
       local_person_id = excluded.local_person_id,
       updated_at      = excluded.updated_at,
       source_app      = 'myfinance'`,
    [
      key,
      input.access_tier ?? 0,
      input.id_proof_ref?.trim() || null,
      input.notes?.trim() || null,
      id,
      now,
    ],
  );
}

export async function deletePerson(id: number): Promise<void> {
  // Deleting the thin link row drives the estate FKs (holdings/access_grants CASCADE,
  // documents/reminders/will_meta/incapacity_meta/insurance SET NULL), exactly as before.
  // Then drop the now-orphaned spine identity + facet for this finance contact.
  const db = await getDb();
  const rows = await db.select<{ person_key: string }[]>(
    `SELECT person_key FROM ${T.people} WHERE id = ?`, [id],
  );
  const key = rows[0]?.person_key;
  await db.execute(`DELETE FROM ${T.people} WHERE id = ?`, [id]);
  if (key) {
    await db.execute(`DELETE FROM ${T.personFacet} WHERE person_key = ?`, [key]);
    await db.execute(`DELETE FROM common_person WHERE person_key = ?`, [key]);
  }
}

export async function countPeople(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.people}`);
  return rows[0]?.n ?? 0;
}

/** Delete every person (link + spine identity + facet). Callers clear people-referencing rows first. */
export async function clearAllPeople(): Promise<void> {
  // Drop the spine identity + finance facet for every finance contact (its mf-<id> key),
  // then the thin link rows (whose delete drives the estate FKs).
  const keys = await query<{ person_key: string }>(`SELECT person_key FROM ${T.people}`);
  for (const { person_key } of keys) {
    await exec(`DELETE FROM ${T.personFacet} WHERE person_key = ?`, [person_key]);
    await exec(`DELETE FROM common_person WHERE person_key = ?`, [person_key]);
  }
  await exec(`DELETE FROM ${T.people}`);
}
