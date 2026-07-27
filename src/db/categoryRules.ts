import { query, exec, T } from "./client";
import { normalize } from "@/domain/transactionCategory";

export interface CategoryRuleRow {
  id: number;
  pattern: string;
  category: string;
  hit_count: number;
  created_at: string;
  updated_at: string | null;
}

/**
 * Teaches (or reinforces) a learned rule from a raw narration — normalizes
 * internally, same idiom as transactionCategory.ts's similarByDescription. One
 * pattern can teach multiple categories (a UPI narration can be learned as both
 * "upi_payment" and "groceries"); re-teaching the exact same (pattern, category)
 * pair just bumps hit_count. No-ops for a blank/whitespace description.
 */
export async function upsertCategoryRule(description: string, category: string): Promise<void> {
  const pattern = normalize(description);
  if (!pattern) return;
  await exec(
    `INSERT INTO ${T.categoryRules} (pattern, category) VALUES (?, ?)
     ON CONFLICT(pattern, category) DO UPDATE SET
       hit_count  = ${T.categoryRules}.hit_count + 1,
       updated_at = datetime('now')`,
    [pattern, category],
  );
}

/** pattern → every category ever learned for it. Load once per import batch /
 *  wizard mount, not per row. */
export async function getCategoryRuleMap(): Promise<Map<string, string[]>> {
  const rows = await query<{ pattern: string; category: string }>(`SELECT pattern, category FROM ${T.categoryRules}`);
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.pattern);
    if (list) list.push(r.category);
    else map.set(r.pattern, [r.category]);
  }
  return map;
}

/** Full rows for a "Learned rules" review list — most-relied-on first. */
export async function listCategoryRules(): Promise<CategoryRuleRow[]> {
  return query<CategoryRuleRow>(`SELECT * FROM ${T.categoryRules} ORDER BY hit_count DESC, updated_at DESC`);
}

/** "Forget" — the rule stops auto-applying; doesn't touch any transaction that
 *  already carries the category it once suggested. */
export async function deleteCategoryRule(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.categoryRules} WHERE id = ?`, [id]);
}
