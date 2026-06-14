import { query, exec, T } from "./client";

export type SnapshotSource = "manual" | "import";

export interface Snapshot {
  id: number;
  account_id: number;
  month: string; // YYYY-MM
  value: number;
  note: string | null;
  source: SnapshotSource;
  updated_at: string;
}

export interface SnapshotInput {
  account_id: number;
  month: string; // YYYY-MM
  value: number;
  note?: string | null;
  source?: SnapshotSource;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string) {
  if (!MONTH_RE.test(month)) {
    throw new Error(`Invalid month '${month}'. Expected YYYY-MM.`);
  }
}

export async function listSnapshotsForAccount(accountId: number): Promise<Snapshot[]> {
  return query<Snapshot>(
    `SELECT * FROM ${T.monthlySnapshot} WHERE account_id = ? ORDER BY month DESC`,
    [accountId],
  );
}

export async function listSnapshotsForMonth(month: string): Promise<Snapshot[]> {
  assertMonth(month);
  return query<Snapshot>(
    `SELECT * FROM ${T.monthlySnapshot} WHERE month = ? ORDER BY account_id`,
    [month],
  );
}

/** Insert-or-update a snapshot (unique on account_id, month). */
export async function upsertSnapshot(input: SnapshotInput): Promise<void> {
  assertMonth(input.month);
  await exec(
    `INSERT INTO ${T.monthlySnapshot} (account_id, month, value, note, source, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(account_id, month) DO UPDATE SET
       value = excluded.value,
       note = excluded.note,
       source = excluded.source,
       updated_at = datetime('now')`,
    [
      input.account_id,
      input.month,
      input.value,
      input.note?.trim() || null,
      input.source ?? "manual",
    ],
  );
}

export async function deleteSnapshot(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.monthlySnapshot} WHERE id = ?`, [id]);
}

/** Count of all stored monthly snapshots (across every account/month). */
export async function countSnapshots(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.monthlySnapshot}`);
  return rows[0]?.n ?? 0;
}

/** Delete every monthly snapshot. Accounts, goals, and settings are left intact. */
export async function clearAllSnapshots(): Promise<void> {
  await exec(`DELETE FROM ${T.monthlySnapshot}`);
}

/** Sum of all non-archived account values for a given month. */
export async function totalForMonth(month: string): Promise<number> {
  assertMonth(month);
  const rows = await query<{ total: number | null }>(
    `SELECT SUM(s.value) AS total
       FROM ${T.monthlySnapshot} s
       JOIN ${T.accounts} a ON a.id = s.account_id
      WHERE s.month = ? AND a.is_archived = 0`,
    [month],
  );
  return rows[0]?.total ?? 0;
}

/** All distinct months present in the snapshot table, newest first. */
export async function listMonths(): Promise<string[]> {
  const rows = await query<{ month: string }>(
    `SELECT DISTINCT month FROM ${T.monthlySnapshot} ORDER BY month DESC`,
  );
  return rows.map((r) => r.month);
}
