import { query, exec, T } from "./client";
import { isTauri } from "@/lib/environment";
import type { MasterOption } from "@/masters/types";

/**
 * Over-the-air "remote" master options (migration 0019). Reference data pushed
 * independently of the app binary — signature/hash-verified and decrypted on the
 * Rust side, then upserted here. These layer between the baked static masters and
 * the user's own `custom_options`. See `src/masters/store.ts` for the merge order
 * and docs/plans/master-and-app-updates.md for the update mechanism.
 */
export interface MasterOptionRow {
  master_id: string;
  value: string;
  label: string;
  icon: string | null;
  parent: string | null;
  version: number;
}

/** Remote options for a master, optionally scoped to a `parent` (e.g. city ← country). */
export async function listMasterOptions(
  masterId: string,
  parent: string | null = null,
): Promise<MasterOption[]> {
  if (!isTauri()) return [];
  const rows = await query<MasterOptionRow>(
    `SELECT master_id, value, label, icon, parent, version FROM ${T.masterOptions}
       WHERE master_id = ? AND parent IS ?
       ORDER BY label COLLATE NOCASE`,
    [masterId, parent],
  );
  return rows.map((r) => ({
    value: r.value,
    label: r.label,
    icon: r.icon ?? undefined,
    source: "remote" as const,
  }));
}

/**
 * Transactionally replace the remote option set for one master (and `version`).
 * Used by the data-update track after a verified download. No-op off Tauri.
 * The caller is responsible for having validated `options` (see updateSchema).
 */
export async function upsertMasterOptions(
  masterId: string,
  options: Array<MasterOption & { parent?: string | null }>,
  version: number,
): Promise<void> {
  if (!isTauri()) return;
  // `@tauri-apps/plugin-sql` pools connections, so a transaction can't span separate
  // `execute()` calls (BEGIN/COMMIT land on different connections and fail). Upsert
  // row-by-row (each auto-commits); a partial apply is self-healing on the next sync.
  for (const o of options) {
    await exec(
      `INSERT INTO ${T.masterOptions} (master_id, value, label, icon, parent, version)
         VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(master_id, parent, value) DO UPDATE SET
         label = excluded.label,
         icon = excluded.icon,
         version = excluded.version,
         updated_at = datetime('now')`,
      [masterId, o.value, o.label, o.icon ?? null, o.parent ?? null, version],
    );
  }
}

/** Drop all remote options for a master (e.g. on a publisher removal). No-op off Tauri. */
export async function clearMasterOptions(masterId: string): Promise<void> {
  if (!isTauri()) return;
  await exec(`DELETE FROM ${T.masterOptions} WHERE master_id = ?`, [masterId]);
}
