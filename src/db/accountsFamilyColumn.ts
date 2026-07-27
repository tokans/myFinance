/**
 * Self-healing `ALTER TABLE ADD COLUMN` for `myfinance_accounts.is_family` and
 * `.family_relation`.
 *
 * The descriptor fields in `legacySchemas.ts` are enough on their own for an
 * ALREADY-REGISTERED install: `registerSchemas`' additive-field diff issues the
 * ALTER automatically (CONTRACT §8 "additive merges auto-apply"). But on a
 * BRAND NEW database, aux-SQL step v1 (`auxSql.ts`) unconditionally rebuilds
 * `accounts` from its own frozen legacy DDL string immediately after first
 * registration — that DDL predates these fields, so it drops the columns the
 * descriptor step just created, moments before the app ever writes to them.
 *
 * A plain new `registerAuxMigrations` version can't fix this either: for an
 * install that already has the columns (added by `registerSchemas` on the very
 * same launch, which always runs first), a second unconditional ADD COLUMN
 * would throw "duplicate column name". Checking first is the only version-
 * portable, collision-free fix (SQLite's `ADD COLUMN IF NOT EXISTS` needs 3.35+
 * and this repo can't assume that everywhere it runs). No ledger needed — the
 * `PRAGMA table_info` check IS the idempotency guard, and ADD COLUMN can't lose
 * data, so there's nothing to verify.
 */
import type { SqlDb } from "sharedcorelib/db";
import { T } from "./tables";

export async function ensureAccountsFamilyColumn(suite: SqlDb): Promise<void> {
  const cols = await suite.select<{ name: string }>(`PRAGMA table_info(${T.accounts})`);
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("is_family")) {
    await suite.execute(`ALTER TABLE ${T.accounts} ADD COLUMN is_family INTEGER`);
  }
  if (!names.has("family_relation")) {
    await suite.execute(`ALTER TABLE ${T.accounts} ADD COLUMN family_relation TEXT`);
  }
}
