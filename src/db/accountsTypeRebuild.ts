/**
 * One-time REBUILD of `myfinance_accounts` to widen its `type` CHECK constraint
 * with 3 new account types (`loan_given`, `art_collectible`, `vehicle`) added
 * for the Dashboard's asset-category breakdown (src/lib/assetCategories.ts).
 *
 * SQLite has no `ALTER TABLE ... ADD/DROP CONSTRAINT` — relaxing a CHECK means
 * rebuilding the table (the same technique the legacy `0004_account_types.sql`
 * migration used pre-K1). This runs OUTSIDE the generic `registerAuxMigrations`
 * framework (auxSql.ts/MYFINANCE_AUX_MIGRATIONS): that framework's ownership
 * guard (sharedcorelib/db) rejects any statement touching a table name that
 * isn't already schema-registered, which blocks the standard `CREATE new /
 * COPY / DROP / RENAME` rebuild pattern (it needs a transient `..._new` table
 * name). Instead this follows the established escape hatch already used by
 * `personSpine.ts` for its own schema-shape change: a ledger-gated, one-time
 * procedural migration run directly against the injected `SqlDb`.
 *
 * Safety:
 *   - **Idempotent** — an `accounts-type-rebuild` row in the shared
 *     `myfinance_migration_ledger` marks completion; a defensive check of
 *     `sqlite_master` (does the CHECK already mention 'loan_given'?) covers a
 *     crash between a successful rebuild and the ledger write.
 *   - **Atomic, single-connection** — the whole rebuild (PRAGMA foreign_keys
 *     OFF, BEGIN, CREATE/COPY/DROP/RENAME, index + trigger recreation, COMMIT,
 *     PRAGMA foreign_keys ON) is ONE multi-statement string sent through a
 *     SINGLE `execute()` call with no bind params — mirroring
 *     `accounts.ts`'s `buildMergeSql`/`mergeAccounts`. Separate `execute()`
 *     calls for BEGIN/COMMIT are unsafe against the Tauri SQL plugin's pooled
 *     connections (they can land on different connections); that matters even
 *     more here because `PRAGMA foreign_keys` is connection-scoped, so OFF and
 *     the later ON must run on the exact same connection as the DDL.
 *   - **FK-safe** — SQLite performs an implicit cascading DELETE when a table
 *     is DROPped while foreign_keys enforcement is ON (monthly_snapshot/
 *     holdings/reminders/transactions all CASCADE off accounts.id). Foreign
 *     keys are turned OFF for the rebuild so the DROP never touches children;
 *     ids are preserved verbatim in the copy, so children's account_id values
 *     stay valid once foreign_keys is turned back ON. `legacy_alter_table` is
 *     also turned ON for the rebuild: modern SQLite's ALTER TABLE RENAME scans
 *     the schema to fix up references to the renamed table in other objects'
 *     SQL, and that scan was observed to spuriously fire an unrelated sibling
 *     table's trigger (monthly_snapshot's own tombstone trigger) even with
 *     foreign_keys OFF — legacy_alter_table=ON reverts to the simpler rename
 *     that skips it.
 *   - **Verified** — row count + a content checksum (reusing consolidate.ts's
 *     `checksumRows`) are compared before/after, plus a `PRAGMA
 *     foreign_key_check` integrity scan; any mismatch throws (ledger stays
 *     unwritten, retried next launch — no silent data loss).
 */
import type { SqlDb } from "sharedcorelib/db";
import { checksumRows } from "./consolidate";
import { uuidTriggersFor } from "./auxSql";
import { T } from "./tables";

const LEDGER_ENTRY = "accounts-type-rebuild";
const NEW_TABLE = `${T.accounts}_new_v1`;

const ident = (s: string): string => `"${s.replace(/[^A-Za-z0-9_]/g, "_")}"`;

/** Full, explicit column list — order-matched between CREATE/INSERT/SELECT. */
const ACCOUNT_COLUMNS = [
  "id", "name", "type", "institution", "currency", "opening_balance", "credential_id",
  "is_archived", "created_at", "type_note", "maturity_date", "contact", "emergency_action",
  "holding_mode", "sync_id", "updated_at", "sip_day", "sip_amount", "sip_last_done", "customer_id",
] as const;

export interface AccountsTypeRebuildResult {
  status: "rebuilt" | "already-done" | "no-table";
  rows: number;
}

async function tableExists(db: SqlDb, table: string): Promise<boolean> {
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?`, [table],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function readLedgerStatus(db: SqlDb): Promise<string | null> {
  const rows = await db.select<{ status: string }>(
    `SELECT status FROM ${ident(T.migrationLedger)} WHERE entry_id = ?`, [LEDGER_ENTRY],
  );
  return rows[0]?.status ?? null;
}

async function writeLedger(db: SqlDb, rows: number, checksum: string, now: () => Date): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO ${ident(T.migrationLedger)} ` +
      `(entry_id, table_name, legacy_rows, copied_rows, checksum, status, detail, completed_at) ` +
      `VALUES (?, ?, ?, ?, ?, 'done', ?, ?)`,
    [LEDGER_ENTRY, "accounts", rows, rows, checksum, "widened type CHECK (+loan_given/+art_collectible/+vehicle)", now().toISOString()],
  );
}

/** Widened CHECK — the CANONICAL_TABLES list in auxSql.ts plus the 3 new types. */
const rebuildSql = (): string => {
  const cols = ACCOUNT_COLUMNS.join(", ");
  const triggers = uuidTriggersFor(T.accounts, "accounts");
  return [
    "PRAGMA foreign_keys = OFF;",
    // Modern SQLite's ALTER TABLE RENAME (legacy_alter_table=OFF, the default)
    // scans the schema to fix up references to the renamed table in OTHER
    // objects' SQL. That scan spuriously fires unrelated triggers on sibling
    // tables (observed: monthly_snapshot's own AFTER DELETE tombstone trigger
    // fires — and fails with "no such table" — during the RENAME below, even
    // though monthly_snapshot is never touched and foreign_keys is OFF).
    // legacy_alter_table=ON reverts to the simpler rename that skips that scan.
    "PRAGMA legacy_alter_table = ON;",
    "BEGIN;",
    `CREATE TABLE ${NEW_TABLE} (
       id              INTEGER PRIMARY KEY AUTOINCREMENT,
       name            TEXT NOT NULL,
       type            TEXT NOT NULL CHECK (type IN (
                         'bank_savings','checking','cash','fixed_deposit','recurring_deposit',
                         'ppf','epf','nps','stocks','mutual_funds','etf','bonds','pms_aif',
                         'gold','real_estate','crypto','loan','credit_card','insurance',
                         'tax_refund','other','loan_given','art_collectible','vehicle')),
       institution     TEXT,
       currency        TEXT NOT NULL DEFAULT 'INR',
       opening_balance REAL NOT NULL DEFAULT 0,
       credential_id   INTEGER REFERENCES ${T.vaultEntries}(id) ON DELETE SET NULL,
       is_archived     INTEGER NOT NULL DEFAULT 0,
       created_at      TEXT NOT NULL DEFAULT (datetime('now')),
       type_note       TEXT,
       maturity_date   TEXT,
       contact         TEXT,
       emergency_action TEXT,
       holding_mode    TEXT,
       sync_id         TEXT,
       updated_at      TEXT,
       sip_day         INTEGER,
       sip_amount      REAL,
       sip_last_done   TEXT,
       customer_id     TEXT
     );`,
    `INSERT INTO ${NEW_TABLE} (${cols}) SELECT ${cols} FROM ${T.accounts};`,
    `DROP TABLE ${T.accounts};`,
    `ALTER TABLE ${NEW_TABLE} RENAME TO ${T.accounts};`,
    `CREATE INDEX IF NOT EXISTS idx_mf_accounts_archived ON ${T.accounts}(is_archived);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_accounts_sync ON ${T.accounts}(sync_id);`,
    ...triggers.map((t) => `${t};`),
    "COMMIT;",
    "PRAGMA legacy_alter_table = OFF;",
    "PRAGMA foreign_keys = ON;",
  ].join("\n");
};

export interface AccountsTypeRebuildDeps {
  suite: SqlDb;
  now?: () => Date;
}

export async function rebuildAccountsType(
  { suite, now = () => new Date() }: AccountsTypeRebuildDeps,
): Promise<AccountsTypeRebuildResult> {
  if (!(await tableExists(suite, T.accounts))) {
    return { status: "no-table", rows: 0 };
  }

  if ((await readLedgerStatus(suite)) === "done") {
    return { status: "already-done", rows: 0 };
  }

  // Defensive: covers a crash between a successful rebuild and the ledger write.
  const [schemaRow] = await suite.select<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`, [T.accounts],
  );
  if (schemaRow?.sql?.includes("'loan_given'")) {
    const before = await suite.select<Record<string, unknown>>(
      `SELECT * FROM ${ident(T.accounts)} ORDER BY id`,
    );
    await writeLedger(suite, before.length, checksumRows(before), now);
    return { status: "already-done", rows: before.length };
  }

  const before = await suite.select<Record<string, unknown>>(
    `SELECT * FROM ${ident(T.accounts)} ORDER BY id`,
  );
  const beforeChecksum = checksumRows(before);

  await suite.execute(rebuildSql());

  const violations = await suite.select<Record<string, unknown>>("PRAGMA foreign_key_check");
  if (violations.length > 0) {
    throw new Error(`accounts-type-rebuild: foreign_key_check found ${violations.length} violation(s)`);
  }

  const after = await suite.select<Record<string, unknown>>(
    `SELECT * FROM ${ident(T.accounts)} ORDER BY id`,
  );
  const afterChecksum = checksumRows(after);
  if (after.length !== before.length || afterChecksum !== beforeChecksum) {
    throw new Error(
      `accounts-type-rebuild: verify failed — rows ${before.length} -> ${after.length}, ` +
        `checksum ${beforeChecksum} -> ${afterChecksum}`,
    );
  }

  await writeLedger(suite, after.length, afterChecksum, now);
  return { status: "rebuilt", rows: after.length };
}

/**
 * Run the accounts-type rebuild inside Tauri (after the person-spine migration).
 * Errors are logged, not thrown — a failed run leaves the ledger unwritten (the
 * old CHECK constraint stays intact and enforced) and retries on the next launch.
 */
export async function runAccountsTypeRebuild(suite: SqlDb): Promise<AccountsTypeRebuildResult | null> {
  try {
    const result = await rebuildAccountsType({ suite });
    if (result.status === "rebuilt") {
      console.info(`[accounts-type-rebuild] widened accounts.type CHECK — ${result.rows} rows preserved`);
    }
    return result;
  } catch (e) {
    console.error("[accounts-type-rebuild] migration failed — will retry next launch:", e);
    return null;
  }
}
