import { query, exec, T } from "./client";

export interface Goal {
  id: number;
  name: string;
  target_amount: number;
  target_date: string | null;
  baseline_month: string | null;
  account_filter: string | null;
  /** Life-goal template key (see domain/lifeGoals.ts), or null for custom goals. */
  category: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface GoalInput {
  name: string;
  target_amount: number;
  target_date?: string | null;
  baseline_month?: string | null;
  category?: string | null;
}

export async function listGoals(opts: { includeArchived?: boolean } = {}): Promise<Goal[]> {
  const where = opts.includeArchived ? "" : "WHERE archived_at IS NULL";
  return query<Goal>(`SELECT * FROM ${T.goals} ${where} ORDER BY created_at DESC`);
}

export async function createGoal(input: GoalInput): Promise<void> {
  await exec(
    `INSERT INTO ${T.goals} (name, target_amount, target_date, baseline_month, category)
     VALUES (?, ?, ?, ?, ?)`,
    [input.name.trim(), input.target_amount, input.target_date ?? null, input.baseline_month ?? null, input.category ?? null],
  );
}

export async function updateGoal(id: number, input: GoalInput): Promise<void> {
  await exec(
    `UPDATE ${T.goals} SET name = ?, target_amount = ?, target_date = ?, baseline_month = ?, category = ? WHERE id = ?`,
    [input.name.trim(), input.target_amount, input.target_date ?? null, input.baseline_month ?? null, input.category ?? null, id],
  );
}

export async function archiveGoal(id: number, archived: boolean): Promise<void> {
  await exec(
    `UPDATE ${T.goals} SET archived_at = ${archived ? "datetime('now')" : "NULL"} WHERE id = ?`,
    [id],
  );
}

export async function deleteGoal(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.goals} WHERE id = ?`, [id]);
}

/** Total number of goals (including archived). */
export async function countGoals(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.goals}`);
  return rows[0]?.n ?? 0;
}

/**
 * Number of active (non-archived) goals in the given life-goal category.
 * Used to gate FIRE planning on a Healthy Retirement goal specifically.
 */
export async function countGoalsInCategory(category: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${T.goals} WHERE category = ? AND archived_at IS NULL`,
    [category],
  );
  return rows[0]?.n ?? 0;
}

/** Delete every goal. */
export async function clearAllGoals(): Promise<void> {
  await exec(`DELETE FROM ${T.goals}`);
}
