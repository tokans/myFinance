import { query, exec, T } from "./client";
import { upsertCategoryRule } from "./categoryRules";

export type CategorySource = "auto" | "manual";

export interface TransactionTagRow {
  id: number;
  transaction_id: number;
  category: string;
  source: CategorySource;
  created_at: string;
  sync_id: string | null;
  updated_at: string | null;
}

/** Every tag, across every account — merged client-side into a
 *  Map<transactionId, string[]> by callers (same idiom Transactions.tsx already
 *  uses for reconLinks' match-count badges), not aggregated in SQL. */
export async function listAllTags(): Promise<TransactionTagRow[]> {
  return query<TransactionTagRow>(`SELECT * FROM ${T.transactionTags}`);
}

/**
 * Adds one or more tags to each of the given transaction ids — additive, never
 * replaces a transaction's existing tags (a UPI grocery payment keeps its
 * "upi_payment" tag when "groceries" is added alongside it). Re-adding a tag
 * that's already there just upgrades its `source` (accepting an auto-suggested
 * tag in the wizard is a confirmed human choice, so it becomes "manual").
 *
 * When `source === "manual"`, this is also the single centralized "teach" hook
 * for the self-learning classifier (db/categoryRules.ts): every distinct
 * (description, category) pair among the affected rows is upserted as a learned
 * rule, independent of the transaction rows themselves — so a merchant once
 * tagged auto-tags identically on every future import even after these exact
 * rows are deleted or the statement is re-imported.
 */
export async function bulkAddTags(ids: number[], categories: string[], source: CategorySource): Promise<void> {
  if (ids.length === 0 || categories.length === 0) return;
  for (const id of ids) {
    for (const category of categories) {
      await exec(
        `INSERT INTO ${T.transactionTags} (transaction_id, category, source) VALUES (?, ?, ?)
         ON CONFLICT(transaction_id, category) DO UPDATE SET source = excluded.source`,
        [id, category, source],
      );
    }
  }
  if (source !== "manual") return;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await query<{ description: string }>(
    `SELECT DISTINCT description FROM ${T.transactions} WHERE id IN (${placeholders})`,
    ids,
  );
  for (const r of rows) for (const category of categories) await upsertCategoryRule(r.description, category);
}

/** Removes one tag from one transaction (the "x" on a tag chip). Deliberately
 *  does NOT touch category_rules — un-teaching a learned rule is a separate,
 *  explicit action (the "Forget" affordance on the learned-rules panel), never
 *  implicit in removing one tag from one row. */
export async function removeTag(transactionId: number, category: string): Promise<void> {
  await exec(`DELETE FROM ${T.transactionTags} WHERE transaction_id = ? AND category = ?`, [transactionId, category]);
}
