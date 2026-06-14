import { query, exec, T } from "./client";
import { isTauri } from "@/lib/environment";

/**
 * Professional "partners" (migration 0020): a curated directory of named
 * professionals/firms the user can pick from when adding a professional contact —
 * a panel of partner doctors, lawyers, chartered accountants, etc. This is the
 * same over-the-air "remote" model as `master_options`: reference data pushed
 * independently of the binary, signature/hash-verified and decrypted on the Rust
 * side, then upserted here. It ships EMPTY — when no partners exist for a
 * professional type the Add-People UX is unchanged. When partners are present the
 * person form surfaces them as a side panel and a click auto-fills the form.
 *
 * Keyed by `professional_type`, which matches a value of the `professional_type`
 * master (e.g. 'Doctor'). See src/masters/updateSchema.ts for the wire contract.
 */
export interface Partner {
  id: number;
  professional_type: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  icon: string | null;
  version: number;
}

/** A partner as it arrives in a decrypted OTA payload (no local id/version yet). */
export interface PartnerInput {
  professionalType: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  icon?: string | null;
}

/** Partners available for a professional type, alphabetical. Empty off Tauri. */
export async function listPartners(professionalType: string): Promise<Partner[]> {
  if (!isTauri() || !professionalType.trim()) return [];
  return query<Partner>(
    `SELECT id, professional_type, name, phone, email, notes, icon, version
       FROM ${T.partners}
      WHERE professional_type = ?
      ORDER BY name COLLATE NOCASE`,
    [professionalType],
  );
}

/**
 * Upsert a batch of partners at a given manifest `version`. Used by the data-update
 * track after a verified download. No-op off Tauri. The caller is responsible for
 * having validated `partners` (see updateSchema).
 *
 * Note: `@tauri-apps/plugin-sql` runs every `execute()` on a pooled connection, so a
 * transaction cannot span separate JS calls — a `BEGIN`/.../`COMMIT` across `exec`s
 * lands on different connections and silently fails. We therefore upsert row-by-row
 * (each auto-commits). For this broadcast reference data a partial apply is self-
 * healing: the next sync re-upserts the full set.
 */
export async function upsertPartners(partners: PartnerInput[], version: number): Promise<void> {
  if (!isTauri()) return;
  for (const p of partners) {
    await exec(
      `INSERT INTO ${T.partners} (professional_type, name, phone, email, notes, icon, version)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(professional_type, name) DO UPDATE SET
         phone = excluded.phone,
         email = excluded.email,
         notes = excluded.notes,
         icon = excluded.icon,
         version = excluded.version,
         updated_at = datetime('now')`,
      [
        p.professionalType.trim(),
        p.name.trim(),
        p.phone?.trim() || null,
        p.email?.trim() || null,
        p.notes?.trim() || null,
        p.icon?.trim() || null,
        version,
      ],
    );
  }
}

/** Drop the whole partners directory (e.g. on a publisher removal). No-op off Tauri. */
export async function clearPartners(): Promise<void> {
  if (!isTauri()) return;
  await exec(`DELETE FROM ${T.partners}`);
}
