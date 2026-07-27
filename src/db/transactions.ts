import { query, exec, getDb, T } from "./client";
import { suggestCategoryTagsWithRules } from "@/domain/transactionCategory";
import { loadTaxProfile } from "@/tax/taxProfile";
import { getCategoryRuleMap } from "./categoryRules";
import { bulkAddTags } from "./transactionTags";

export type MatchStatus = "none" | "suggested" | "confirmed" | "dismissed";

/**
 * Categorization no longer lives here — a transaction's tags are rows in
 * `myfinance_transaction_tags` (db/transactionTags.ts), fetched separately and
 * merged client-side (same idiom as reconLinks' match-count badges). The old
 * `category`/`category_source` columns still exist physically on this table
 * (never dropped from a populated user table) but are dead — nothing reads or
 * writes them anymore.
 */
export interface TransactionRow {
  id: number;
  account_id: number;
  date: string | null;
  raw_date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  matched_transaction_id: number | null;
  match_status: MatchStatus;
  source_path: string | null;
}

export interface TransactionInput {
  account_id: number;
  date: string | null;
  raw_date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  source_path: string | null;
}

export async function listTransactionsForAccount(accountId: number, limit?: number): Promise<TransactionRow[]> {
  const sql = `SELECT * FROM ${T.transactions} WHERE account_id = ? ORDER BY date DESC, id DESC` + (limit != null ? " LIMIT ?" : "");
  const params: unknown[] = limit != null ? [accountId, limit] : [accountId];
  return query<TransactionRow>(sql, params);
}

export interface ListAllTransactionsOptions {
  unclassifiedOnly?: boolean;
  fromDate?: string;
  toDate?: string;
}

/** Cross-account listing — used by the Transactions hub, reconciliation, and SFT cross-check. */
export async function listAllTransactions(opts: ListAllTransactionsOptions = {}): Promise<TransactionRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.unclassifiedOnly) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM ${T.transactionTags} tt WHERE tt.transaction_id = ${T.transactions}.id)`);
  }
  if (opts.fromDate) { clauses.push("date >= ?"); params.push(opts.fromDate); }
  if (opts.toDate) { clauses.push("date <= ?"); params.push(opts.toDate); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return query<TransactionRow>(`SELECT * FROM ${T.transactions} ${where} ORDER BY date DESC, id DESC`, params);
}

/** Returns the new row's id (needed by replaceTransactionsForSource to attach
 *  auto-suggested tags right after insert) — same lastInsertId idiom as
 *  db/accounts.ts's createAccount. */
export async function insertTransaction(row: TransactionInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO ${T.transactions} (account_id, date, raw_date, description, debit, credit, balance, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.account_id, row.date, row.raw_date, row.description, row.debit, row.credit, row.balance, row.source_path],
  );
  return Number(result.lastInsertId);
}

/**
 * Idempotent re-import: deletes every existing row for this exact
 * `(account_id, source_path)` pair, then bulk-inserts the fresh set — an exact
 * replace, not a merge. There's no safe content-based unique key across
 * date+description+amount (same-day duplicate-looking transactions are
 * legitimate), so re-committing the same statement file for the same account is
 * the only case guaranteed not to duplicate rows. A different filename covering
 * an overlapping period adds a second batch rather than deduping by content —
 * a known, documented limitation, not silently guessed at.
 *
 * Each row gets best-effort tag guesses (`source: "auto"`) from its description —
 * every static keyword rule that matches (not just the first, so e.g. a UPI
 * grocery payment gets both "upi_payment" and "groceries"), plus every category
 * the user has ever manually taught for this exact narration pattern
 * (db/categoryRules.ts's getCategoryRuleMap, loaded once for the whole batch) —
 * a convenience default, not authoritative; a row that matches nothing stays
 * untagged for the user to classify rather than being guessed at. The tax
 * filer profile's `name` (if set) is passed through as `selfName` so a
 * narration naming the account holder (a transfer between their own accounts)
 * is recognized as such.
 */
export async function replaceTransactionsForSource(
  accountId: number,
  sourcePath: string,
  rows: Array<Omit<TransactionInput, "account_id" | "source_path">>,
): Promise<number> {
  await exec(`DELETE FROM ${T.transactions} WHERE account_id = ? AND source_path = ?`, [accountId, sourcePath]);
  const profile = await loadTaxProfile();
  const selfName = profile.name.trim() || undefined;
  const learnedRules = await getCategoryRuleMap();
  for (const r of rows) {
    const isCredit = r.credit != null ? true : r.debit != null ? false : undefined;
    const id = await insertTransaction({ ...r, account_id: accountId, source_path: sourcePath });
    const suggestions = suggestCategoryTagsWithRules(r.description, learnedRules, { isCredit, selfName });
    if (suggestions.length > 0) await bulkAddTags([id], suggestions.map((s) => s.category), "auto");
  }
  return rows.length;
}

export async function deleteTransactionsForAccount(accountId: number): Promise<void> {
  await exec(`DELETE FROM ${T.transactions} WHERE account_id = ?`, [accountId]);
}

/** Deletes an arbitrary set of rows by id — the "Delete transaction" pseudo-category
 *  in the wizard/bulk-classify UI (see `transactionCategory.ts`'s DELETE_TRANSACTION_CATEGORY). */
export async function deleteTransactionsByIds(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await exec(`DELETE FROM ${T.transactions} WHERE id IN (${placeholders})`, ids);
}

/** Wipes the entire cross-account ledger — the Transactions page's "Clear all
 *  transactions" reset, for when re-importing from scratch. Irreversible. */
export async function deleteAllTransactions(): Promise<void> {
  await exec(`DELETE FROM ${T.transactions}`, []);
}

export async function countTransactionsForAccount(accountId: number): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.transactions} WHERE account_id = ?`, [accountId]);
  return rows[0]?.n ?? 0;
}

/** Symmetric write: links both sides of a confirmed self-transfer pair. Device-local (never synced). */
export async function confirmMatch(aId: number, bId: number): Promise<void> {
  await exec(`UPDATE ${T.transactions} SET matched_transaction_id = ?, match_status = 'confirmed' WHERE id = ?`, [bId, aId]);
  await exec(`UPDATE ${T.transactions} SET matched_transaction_id = ?, match_status = 'confirmed' WHERE id = ?`, [aId, bId]);
}

/** Marks a candidate pair as reviewed-and-rejected so it doesn't resurface on the next recompute. */
export async function dismissMatch(aId: number, bId: number): Promise<void> {
  await exec(`UPDATE ${T.transactions} SET match_status = 'dismissed' WHERE id IN (?, ?)`, [aId, bId]);
}
