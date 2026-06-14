import { query, exec, T } from "./client";
import { isTauri } from "@/lib/environment";

/**
 * User-added "Other" values for finite-set inputs, stored in the generic
 * `custom_options` table (migration 0007). These merge on top of the baked
 * static masters so the option set grows over time. See `src/masters/`.
 */
export interface CustomOption {
  category: string;
  value: string;
  label: string;
  parent: string | null;
}

/** All custom options for a master `category`, optionally scoped to a `parent`. */
export async function listCustomOptions(
  category: string,
  parent: string | null = null,
): Promise<CustomOption[]> {
  if (!isTauri()) return [];
  const rows = await query<CustomOption>(
    `SELECT category, value, label, parent FROM ${T.customOptions}
       WHERE category = ? AND parent IS ?
       ORDER BY label COLLATE NOCASE`,
    [category, parent],
  );
  return rows;
}

/**
 * Persist a user-added option. Idempotent on (category, parent, value) thanks to
 * the UNIQUE constraint — re-adding the same value is a no-op. No-op off Tauri.
 */
export async function addCustomOption(
  category: string,
  value: string,
  label: string,
  parent: string | null = null,
): Promise<void> {
  if (!isTauri()) return;
  await exec(
    `INSERT OR IGNORE INTO ${T.customOptions} (category, value, label, parent)
       VALUES (?, ?, ?, ?)`,
    [category, value, label, parent],
  );
}
