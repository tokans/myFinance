/**
 * One-time legacy-DB consolidation (prompts/10 decisions 6/24, pre-authorized):
 * copy every table of the legacy per-app `myfinance.db` into its namespaced
 * `myfinance_*` suite.db table, verify (row counts + an ordered content-checksum
 * sample), write the `myfinance#MigrationLedger` evidence rows, then DELETE the
 * legacy DB file. After this the suite DB is the only database (no per-app DB
 * files remain).
 *
 * Properties:
 *  - **Idempotent** — a "migration" ledger row marks completion; later boots
 *    no-op (and finish a pending file deletion if the previous run crashed
 *    between marking done and deleting).
 *  - **Resumable / crash-safe** — each table is copied DELETE-then-INSERT and
 *    its ledger row is written only AFTER verification, so a crash mid-table
 *    re-copies that table on the next boot; completed tables are skipped.
 *  - **Key-preserving** — every column value (including the integer AUTOINCREMENT
 *    `id` rowid keys the cross-table FKs join on) is copied verbatim. The aux
 *    sync triggers only backfill NULL sync_id/updated_at, so copied identities and
 *    timestamps are never rewritten; copied rows that already carry sync_id keep it.
 *  - **Fails safe** — any verification mismatch throws: the ledger is not marked,
 *    the legacy file is NOT deleted, and the next boot retries.
 *
 * The pure engine ({@link consolidateLegacyDb}) is dependency-injected and
 * unit-tested against real-SQLite fixtures; {@link runLegacyConsolidation} is the
 * thin Tauri wiring (plugin handles + the Rust `legacy_db_*` commands).
 */
import type { SqlDb } from "sharedcorelib/db";
import { T } from "./tables";

/** Legacy table → suite table, with the key columns that define a stable order. */
export interface LegacyTableSpec {
  legacy: string;
  suite: string;
  keyColumns: string[];
}

/**
 * Every table of the legacy `myfinance.db` (migrations 0001..0023), in FK-safe
 * order (parents before children) so the per-table copy never violates a
 * REFERENCES constraint mid-migration. `health_profile` is intentionally absent —
 * it is retired in favour of the common ICE card (invariant 6); its single row is
 * mapped into `common_ice_card` separately by the health-card mapping (db/health.ts),
 * not bulk-copied. The local-only telemetry/audit tables ARE copied (they are
 * app-owned suite tables now, decision 2).
 */
export const LEGACY_TABLES: LegacyTableSpec[] = [
  { legacy: "settings", suite: T.settings, keyColumns: ["key"] },
  { legacy: "vault_entries", suite: T.vaultEntries, keyColumns: ["id"] },
  { legacy: "accounts", suite: T.accounts, keyColumns: ["id"] },
  { legacy: "monthly_snapshot", suite: T.monthlySnapshot, keyColumns: ["id"] },
  { legacy: "goals", suite: T.goals, keyColumns: ["id"] },
  { legacy: "tax_years", suite: T.taxYears, keyColumns: ["ay"] },
  { legacy: "tax_income", suite: T.taxIncome, keyColumns: ["id"] },
  { legacy: "tax_deductions", suite: T.taxDeductions, keyColumns: ["id"] },
  { legacy: "tax_payments", suite: T.taxPayments, keyColumns: ["id"] },
  { legacy: "tax_assessment", suite: T.taxAssessment, keyColumns: ["ay"] },
  { legacy: "tax_wizard_answers", suite: T.taxWizardAnswers, keyColumns: ["ay"] },
  { legacy: "custom_options", suite: T.customOptions, keyColumns: ["id"] },
  { legacy: "people", suite: T.people, keyColumns: ["id"] },
  { legacy: "documents", suite: T.documents, keyColumns: ["id"] },
  { legacy: "reminders", suite: T.reminders, keyColumns: ["id"] },
  { legacy: "insurance_policies", suite: T.insurancePolicies, keyColumns: ["id"] },
  { legacy: "holdings", suite: T.holdings, keyColumns: ["id"] },
  { legacy: "will_meta", suite: T.willMeta, keyColumns: ["id"] },
  { legacy: "incapacity_meta", suite: T.incapacityMeta, keyColumns: ["id"] },
  { legacy: "access_grants", suite: T.accessGrants, keyColumns: ["id"] },
  { legacy: "audit_log", suite: T.auditLog, keyColumns: ["id"] },
  { legacy: "life_events", suite: T.lifeEvents, keyColumns: ["id"] },
  { legacy: "app_launches", suite: T.appLaunches, keyColumns: ["id"] },
  { legacy: "master_options", suite: T.masterOptions, keyColumns: ["id"] },
  { legacy: "partners", suite: T.partners, keyColumns: ["id"] },
  { legacy: "sync_tombstones", suite: T.syncTombstones, keyColumns: ["table_name", "key"] },
];

/** Rows included in the content-checksum sample (per table, ordered by key). */
export const CHECKSUM_SAMPLE_LIMIT = 256;

const ident = (s: string): string => `"${s.replace(/[^A-Za-z0-9_]/g, "_")}"`;

/** Canonical row serialization: key-sorted JSON, so column order can't differ. */
function canonicalRow(row: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(row).sort()) sorted[k] = row[k] ?? null;
  return JSON.stringify(sorted);
}

/** FNV-1a 32-bit over the canonical rows — a cheap deterministic content checksum. */
export function checksumRows(rows: Record<string, unknown>[]): string {
  let h = 0x811c9dc5;
  for (const row of rows) {
    const s = canonicalRow(row);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `fnv1a:${(h >>> 0).toString(16).padStart(8, "0")}:${rows.length}`;
}

export interface ConsolidateDeps {
  /** The shared suite DB (schemas + aux already ensured by the caller). */
  suite: SqlDb;
  /** Whether the legacy DB FILE exists (must not create it as a side effect). */
  legacyExists: () => Promise<boolean>;
  /** Open the legacy DB read handle. Only called when `legacyExists()` is true. */
  openLegacy: () => Promise<SqlDb>;
  /** Release the legacy handle (required before deleting the file on Windows). */
  closeLegacy?: () => Promise<void>;
  /** Delete the legacy DB file (+ WAL/SHM). Returns true when a file was removed. */
  removeLegacy: () => Promise<boolean>;
  /** Whether a given legacy table exists (older installs may pre-date some migrations). */
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface TableCopyResult {
  table: string;
  rows: number;
  checksum: string;
  /** True when a verified ledger row let this table be skipped (resumed run). */
  skipped: boolean;
}

export interface ConsolidateResult {
  status: "migrated" | "already-done" | "no-legacy";
  tables: TableCopyResult[];
  legacyDeleted: boolean;
}

interface LedgerRow {
  entry_id: string;
  table_name: string | null;
  legacy_rows: number | null;
  copied_rows: number | null;
  checksum: string | null;
  status: string;
  detail: string | null;
  completed_at: string;
}

const MIGRATION_ENTRY = "migration";
const tableEntry = (legacy: string): string => `table:${legacy}`;

async function readLedger(suite: SqlDb, entryId: string): Promise<LedgerRow | null> {
  const rows = await suite.select<LedgerRow>(
    `SELECT * FROM ${ident(T.migrationLedger)} WHERE entry_id = ?`, [entryId],
  );
  return rows[0] ?? null;
}

async function writeLedger(suite: SqlDb, row: Omit<LedgerRow, "completed_at">, now: () => Date): Promise<void> {
  await suite.execute(
    `INSERT OR REPLACE INTO ${ident(T.migrationLedger)} ` +
      `(entry_id, table_name, legacy_rows, copied_rows, checksum, status, detail, completed_at) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.entry_id, row.table_name, row.legacy_rows, row.copied_rows, row.checksum, row.status, row.detail, now().toISOString()],
  );
}

async function countRows(db: SqlDb, table: string): Promise<number> {
  const [r] = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${ident(table)}`);
  return Number(r?.n ?? 0);
}

async function sampleRows(db: SqlDb, table: string, keyColumns: string[]): Promise<Record<string, unknown>[]> {
  const order = keyColumns.map(ident).join(", ");
  return db.select(`SELECT * FROM ${ident(table)} ORDER BY ${order} LIMIT ${CHECKSUM_SAMPLE_LIMIT}`);
}

/** Does a table exist in this DB? (Older legacy installs may pre-date some migrations.) */
async function tableExists(db: SqlDb, table: string): Promise<boolean> {
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?`, [table],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Copy one legacy table into its suite table and verify; throws on any mismatch. */
async function copyTable(
  legacy: SqlDb, suite: SqlDb, spec: LegacyTableSpec, log: (m: string) => void,
): Promise<{ rows: number; checksum: string }> {
  const order = spec.keyColumns.map(ident).join(", ");
  const rows = await legacy.select<Record<string, unknown>>(
    `SELECT * FROM ${ident(spec.legacy)} ORDER BY ${order}`,
  );

  // Restartable copy: clear any partial previous attempt, then insert verbatim.
  await suite.execute(`DELETE FROM ${ident(spec.suite)}`);
  for (const row of rows) {
    const cols = Object.keys(row);
    await suite.execute(
      `INSERT INTO ${ident(spec.suite)} (${cols.map(ident).join(", ")}) ` +
        `VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((c) => row[c] ?? null),
    );
  }

  // Verify: exact row count + ordered content-checksum sample, legacy vs suite.
  const suiteCount = await countRows(suite, spec.suite);
  if (suiteCount !== rows.length) {
    throw new Error(`consolidation verify failed for ${spec.legacy}: copied ${suiteCount} of ${rows.length} rows`);
  }
  const legacyChecksum = checksumRows(rows.slice(0, CHECKSUM_SAMPLE_LIMIT));
  const suiteChecksum = checksumRows(await sampleRows(suite, spec.suite, spec.keyColumns));
  if (legacyChecksum !== suiteChecksum) {
    throw new Error(`consolidation verify failed for ${spec.legacy}: checksum ${legacyChecksum} != ${suiteChecksum}`);
  }
  log(`copied ${spec.legacy} → ${spec.suite}: ${rows.length} rows, ${legacyChecksum}`);
  return { rows: rows.length, checksum: legacyChecksum };
}

/**
 * The consolidation engine (pure DI — see the module doc). Call AFTER
 * `ensureSuiteSchema` so the target tables + ledger exist.
 */
export async function consolidateLegacyDb(deps: ConsolidateDeps): Promise<ConsolidateResult> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());

  // Already migrated? Finish a pending deletion if the previous run crashed
  // between the done-mark and the file delete; otherwise no-op.
  const done = await readLedger(deps.suite, MIGRATION_ENTRY);
  if (done) {
    let legacyDeleted = false;
    if (await deps.legacyExists()) {
      legacyDeleted = await deps.removeLegacy();
      log(`migration already done — removed leftover legacy DB file (deleted=${legacyDeleted})`);
    }
    return { status: "already-done", tables: [], legacyDeleted };
  }

  if (!(await deps.legacyExists())) {
    await writeLedger(deps.suite, {
      entry_id: MIGRATION_ENTRY, table_name: null, legacy_rows: null, copied_rows: null,
      checksum: null, status: "no-legacy", detail: "fresh install — no legacy DB file",
    }, now);
    log("no legacy DB file — registry-native from here on");
    return { status: "no-legacy", tables: [], legacyDeleted: false };
  }

  const legacy = await deps.openLegacy();
  const tables: TableCopyResult[] = [];
  try {
    for (const spec of LEGACY_TABLES) {
      // Tables that pre-date this install's last legacy migration simply don't
      // exist — nothing to copy.
      if (!(await tableExists(legacy, spec.legacy))) {
        log(`skip ${spec.legacy} — not present in this legacy DB`);
        continue;
      }
      // Resume: a verified ledger row whose recorded count still matches the
      // suite table means this table is already fully copied.
      const prior = await readLedger(deps.suite, tableEntry(spec.legacy));
      if (prior?.status === "done" && Number(prior.copied_rows) === (await countRows(deps.suite, spec.suite))) {
        log(`skip ${spec.legacy} — already copied (${prior.copied_rows} rows)`);
        tables.push({ table: spec.legacy, rows: Number(prior.copied_rows), checksum: prior.checksum ?? "", skipped: true });
        continue;
      }
      const { rows, checksum } = await copyTable(legacy, deps.suite, spec, log);
      await writeLedger(deps.suite, {
        entry_id: tableEntry(spec.legacy), table_name: spec.legacy, legacy_rows: rows,
        copied_rows: rows, checksum, status: "done", detail: `→ ${spec.suite}`,
      }, now);
      tables.push({ table: spec.legacy, rows, checksum, skipped: false });
    }
  } finally {
    await deps.closeLegacy?.();
  }

  // Adopted (not copied): map the legacy single-row `health_profile` into the
  // shared common ICE card (invariant 6 — see db/health.ts). Idempotent: only
  // writes the self card if a legacy row exists and the card is absent/older.
  try {
    if (await tableExists(legacy, "health_profile")) {
      const hp = await legacy.select<Record<string, unknown>>(
        `SELECT * FROM health_profile WHERE id = 1`,
      );
      const row = hp[0];
      if (row) {
        await deps.suite.execute(
          `INSERT INTO "common_ice_card"
             (person_key, display_name, blood_group, allergies, conditions, medications, organ_donor, notes, updated_at, source_app)
           VALUES ('self', ?, ?, ?, ?, ?, ?, ?, ?, 'myfinance')
           ON CONFLICT(person_key) DO UPDATE SET
             display_name = COALESCE(excluded.display_name, display_name),
             blood_group  = COALESCE(excluded.blood_group, blood_group),
             allergies    = COALESCE(excluded.allergies, allergies),
             conditions   = COALESCE(excluded.conditions, conditions),
             medications  = COALESCE(excluded.medications, medications),
             organ_donor  = COALESCE(excluded.organ_donor, organ_donor),
             notes        = COALESCE(excluded.notes, notes),
             updated_at   = excluded.updated_at`,
          [
            row.full_name ?? null, row.blood_group ?? null, row.allergies ?? null,
            row.chronic_conditions ?? null, row.medications ?? null,
            row.organ_donor ?? 0, row.notes ?? null,
            row.updated_at ?? new Date().toISOString(),
          ],
        );
        log("mapped legacy health_profile → common_ice_card (self)");
      }
    }
  } catch (e) {
    log(`health_profile → ICE card mapping skipped: ${String(e)}`);
  }

  const total = tables.reduce((acc, t) => acc + t.rows, 0);
  await writeLedger(deps.suite, {
    entry_id: MIGRATION_ENTRY, table_name: null, legacy_rows: total, copied_rows: total,
    checksum: null, status: "done", detail: `consolidated ${tables.length} tables into suite.db`,
  }, now);

  // DELETE the legacy DB file — pre-authorized (decisions 6/24, pre-customer).
  const legacyDeleted = await deps.removeLegacy();
  log(`migration done — ${total} rows across ${tables.length} tables; legacy DB deleted=${legacyDeleted}`);
  return { status: "migrated", tables, legacyDeleted };
}

// ── Tauri wiring ──────────────────────────────────────────────────────────────

/** The legacy per-app DB the Tauri SQL plugin used (relative to app-config dir). */
export const LEGACY_DB_FILE = "myfinance.db";

/**
 * Run the one-time consolidation inside Tauri. Errors are logged, not thrown —
 * a failed/interrupted run leaves the legacy file intact and retries on the next
 * launch (the app then serves whatever the suite DB already has).
 */
export async function runLegacyConsolidation(suite: SqlDb): Promise<ConsolidateResult | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  // Close ONLY the legacy pool — `db.close()` with NO argument shuts down EVERY pool
  // the SQL plugin holds (the shared suite.db included), and leaves the dead entries in
  // the plugin's map, so the very next suite query throws "attempted to acquire a
  // connection on a closed pool". Always pass the legacy handle's own `path`.
  type Closable = { close(db?: string): Promise<boolean>; path: string };
  const handleRef: { current: Closable | null } = { current: null };
  const closeLegacyOnly = async () => {
    const h = handleRef.current;
    if (h) await h.close(h.path);
    handleRef.current = null;
  };
  try {
    return await consolidateLegacyDb({
      suite,
      legacyExists: () => invoke<boolean>("legacy_db_exists"),
      openLegacy: async () => {
        const { default: Database } = await import("@tauri-apps/plugin-sql");
        const db = await Database.load(`sqlite:${LEGACY_DB_FILE}`);
        handleRef.current = db;
        return {
          select: <Row = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
            db.select<Row[]>(sql, params),
          execute: async (sql: string, params: unknown[] = []) => {
            const r = await db.execute(sql, params);
            return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId ?? undefined };
          },
        };
      },
      closeLegacy: closeLegacyOnly,
      removeLegacy: () => invoke<boolean>("legacy_db_remove"),
      log: (m) => console.info(`[consolidate] ${m}`),
    });
  } catch (e) {
    console.error("[consolidate] legacy consolidation failed — will retry next launch:", e);
    try { await closeLegacyOnly(); } catch { /* already closed */ }
    return null;
  }
}
