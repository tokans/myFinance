import { query, exec, getDb, T } from "./client";
import type { AccessTier } from "./people";

export interface AccessGrant {
  id: number;
  person_id: number;
  tier: AccessTier;
  scope: string | null;
  trigger: string;
  created_at: string;
}

export interface AccessGrantWithPerson extends AccessGrant {
  person_name: string;
}

export async function listGrants(): Promise<AccessGrantWithPerson[]> {
  return query<AccessGrantWithPerson>(
    `SELECT g.*, p.name AS person_name FROM ${T.accessGrants} g
       JOIN ${T.people} p ON p.id = g.person_id ORDER BY g.tier DESC, p.name COLLATE NOCASE`,
  );
}

export async function addGrant(personId: number, tier: AccessTier, scope: string | null): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    `INSERT INTO ${T.accessGrants} (person_id, tier, scope) VALUES (?, ?, ?)`,
    [personId, tier, scope?.trim() || null],
  );
  return Number(r.lastInsertId);
}

export async function deleteGrant(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.accessGrants} WHERE id = ?`, [id]);
}

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  detail: string | null;
}

export async function logAudit(action: string, detail?: string): Promise<void> {
  await exec(`INSERT INTO ${T.auditLog} (action, detail) VALUES (?, ?)`, [action, detail ?? null]);
}

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  return query<AuditEntry>(`SELECT * FROM ${T.auditLog} ORDER BY at DESC, id DESC LIMIT ?`, [limit]);
}

/** Number of access grants. */
export async function countGrants(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.accessGrants}`);
  return rows[0]?.n ?? 0;
}

/** Delete every access grant and the access audit log. */
export async function clearAllGrants(): Promise<void> {
  await exec(`DELETE FROM ${T.accessGrants}`);
  await exec(`DELETE FROM ${T.auditLog}`);
}
