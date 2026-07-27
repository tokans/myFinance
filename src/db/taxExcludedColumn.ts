/**
 * Self-healing `ALTER TABLE ADD COLUMN` for `myfinance_tax_income.excluded` and
 * `myfinance_tax_payments.excluded` — same class of fix as `accountsFamilyColumn.ts`'s
 * `ensureAccountsFamilyColumn` (read that file's doc comment for the full mechanism).
 *
 * `excluded` is a genuinely new field on two tables that already existed (and already
 * had rows) before it was added to the descriptor: on an install that already registered
 * `TaxIncome`/`TaxPayments`, `registerSchemas`' additive-field diff adds the column via a
 * plain `ALTER TABLE ADD COLUMN` (no DEFAULT) the moment the app boots with the new
 * descriptor — before any raw aux-SQL step touching the same column ever gets a chance to
 * run, so a version step doing `ADD COLUMN excluded ... DEFAULT 0` would throw "duplicate
 * column name" on every such install (verified: an aux-SQL version for this was tried and
 * removed for exactly this reason — see auxSql.ts's history note where v9 used to be).
 * On a BRAND NEW database registerSchemas' initial CREATE bakes the column in too, but aux
 * step v1 (`CANONICAL_TABLES`) unconditionally rebuilds both tables from a frozen legacy
 * DDL that predates `excluded`, wiping it — the same "v1 resets a just-added column" hazard
 * `is_family`/`family_relation` has.
 *
 * So this must handle BOTH gaps: add the column if it's still missing (fresh-DB case), and
 * backfill any NULL to 0 if it's already there but never got a DEFAULT (already-registered
 * case) — `listIncome`/`listPayments` filter `WHERE excluded = 0`, which silently hides a
 * row whose `excluded` is NULL instead of 0.
 */
import type { SqlDb } from "sharedcorelib/db";
import { T } from "./tables";

export async function ensureTaxExcludedColumns(suite: SqlDb): Promise<void> {
  for (const table of [T.taxIncome, T.taxPayments]) {
    const cols = await suite.select<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === "excluded")) {
      await suite.execute(`ALTER TABLE ${table} ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0`);
    } else {
      await suite.execute(`UPDATE ${table} SET excluded = 0 WHERE excluded IS NULL`);
    }
  }
}
