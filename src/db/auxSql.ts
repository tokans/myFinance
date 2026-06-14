/**
 * K1 consolidation — app-scoped aux-SQL steps (core `registerAuxMigrations`,
 * CONTRACT §8.6) that carry everything the semantic SchemaDescriptors
 * (`legacySchemas.ts`) cannot express, rewritten against the namespaced
 * `myfinance_*` suite-DB tables. The per-app Tauri-plugin migration array (the
 * 23 `0001..0023` SQL files) is retired in favour of this.
 *
 * Why a full table REBUILD (step v1) instead of leaning on descriptor DDL:
 * the legacy schema relies on integer `INTEGER PRIMARY KEY AUTOINCREMENT` rowid
 * keys (FKs across accounts/people/documents/tax_years join on them and the
 * one-time migrator copies the integer ids verbatim), CHECK constraints, column
 * DEFAULTs, composite UNIQUE constraints and FK cascades. The descriptor DDL
 * generator emits only TEXT/REAL/INTEGER affinities + simple PK/indexes — it
 * would give `id` TEXT affinity and drop the constraints. So step v1 DROPs the
 * (empty) descriptor-created shells and recreates each table with the exact
 * legacy DDL. registerSchemas runs first and registers OWNERSHIP in the registry
 * (its `CREATE TABLE IF NOT EXISTS` is the shell we drop); the aux ownership
 * guard then permits these statements because every table is registered to
 * `myfinance`. On boot 2+ the descriptor CREATE no-ops (table exists) and aux v1
 * is already recorded (skipped) — so the canonical tables are stable.
 *
 * Step v2 recreates the 0021 sync-trigger suite (sync_id/updated_at backfill,
 * updated_at touch, and tombstone triggers incl. the 0021/0022 natural-key
 * monthly_snapshot pattern) against the namespaced names.
 *
 * Append-only: NEVER edit a shipped step — add a new version.
 */
import type { AuxMigrationStep } from "sharedcorelib/db";
import { T } from "./tables";

/**
 * The canonical legacy DDL for every myFinance table, namespaced. This is the
 * net of all 23 legacy migrations (0001..0023) collapsed to a single CREATE per
 * table — there are no existing customer DBs of the suite schema to evolve
 * incrementally (decision 6: pre-customer one-time migration), so the end-state
 * DDL is created directly. FK clauses reference the namespaced tables.
 */
const CANONICAL_TABLES: string[] = [
  `DROP TABLE IF EXISTS ${T.settings}`,
  `CREATE TABLE IF NOT EXISTS ${T.settings} (
     key   TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   )`,

  `DROP TABLE IF EXISTS ${T.vaultEntries}`,
  `CREATE TABLE IF NOT EXISTS ${T.vaultEntries} (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     label          TEXT NOT NULL,
     stronghold_key TEXT NOT NULL UNIQUE,
     created_at     TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id        TEXT,
     updated_at     TEXT
   )`,

  // accounts — net of 0001/0004/0005/0006/0008/0013/0021/0022/0023.
  `DROP TABLE IF EXISTS ${T.accounts}`,
  `CREATE TABLE IF NOT EXISTS ${T.accounts} (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     name            TEXT NOT NULL,
     type            TEXT NOT NULL CHECK (type IN (
                       'bank_savings','checking','cash','fixed_deposit','recurring_deposit',
                       'ppf','epf','nps','stocks','mutual_funds','etf','bonds','pms_aif',
                       'gold','real_estate','crypto','loan','credit_card','insurance',
                       'tax_refund','other')),
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
     sip_last_done   TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_accounts_archived ON ${T.accounts}(is_archived)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_accounts_sync ON ${T.accounts}(sync_id)`,

  `DROP TABLE IF EXISTS ${T.monthlySnapshot}`,
  `CREATE TABLE IF NOT EXISTS ${T.monthlySnapshot} (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id  INTEGER NOT NULL REFERENCES ${T.accounts}(id) ON DELETE CASCADE,
     month       TEXT NOT NULL,
     value       REAL NOT NULL,
     note        TEXT,
     source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
     updated_at  TEXT,
     UNIQUE (account_id, month)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_snapshot_month ON ${T.monthlySnapshot}(month)`,
  `CREATE INDEX IF NOT EXISTS idx_mf_snapshot_account_month ON ${T.monthlySnapshot}(account_id, month)`,

  `DROP TABLE IF EXISTS ${T.goals}`,
  `CREATE TABLE IF NOT EXISTS ${T.goals} (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     name            TEXT NOT NULL,
     target_amount   REAL NOT NULL,
     target_date     TEXT,
     baseline_month  TEXT,
     account_filter  TEXT,
     created_at      TEXT NOT NULL DEFAULT (datetime('now')),
     archived_at     TEXT,
     category        TEXT,
     sync_id         TEXT,
     updated_at      TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_goals_sync ON ${T.goals}(sync_id)`,

  // tax (0002).
  `DROP TABLE IF EXISTS ${T.taxYears}`,
  `CREATE TABLE IF NOT EXISTS ${T.taxYears} (
     ay                TEXT PRIMARY KEY NOT NULL,
     itr_form          TEXT,
     itr_form_source   TEXT,
     imported_filename TEXT,
     notes             TEXT,
     created_at        TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `DROP TABLE IF EXISTS ${T.taxIncome}`,
  `CREATE TABLE IF NOT EXISTS ${T.taxIncome} (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     ay          TEXT NOT NULL REFERENCES ${T.taxYears}(ay) ON DELETE CASCADE,
     head        TEXT NOT NULL,
     label       TEXT NOT NULL,
     amount      REAL NOT NULL,
     source_path TEXT,
     note        TEXT,
     sync_id     TEXT,
     updated_at  TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_tax_income_ay ON ${T.taxIncome}(ay)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_tax_income_sync ON ${T.taxIncome}(sync_id)`,
  `DROP TABLE IF EXISTS ${T.taxDeductions}`,
  `CREATE TABLE IF NOT EXISTS ${T.taxDeductions} (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     ay          TEXT NOT NULL REFERENCES ${T.taxYears}(ay) ON DELETE CASCADE,
     section     TEXT NOT NULL,
     label       TEXT NOT NULL,
     amount      REAL NOT NULL,
     source_path TEXT,
     note        TEXT,
     sync_id     TEXT,
     updated_at  TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_tax_deductions_ay ON ${T.taxDeductions}(ay)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_tax_deductions_sync ON ${T.taxDeductions}(sync_id)`,
  `DROP TABLE IF EXISTS ${T.taxPayments}`,
  `CREATE TABLE IF NOT EXISTS ${T.taxPayments} (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     ay          TEXT NOT NULL REFERENCES ${T.taxYears}(ay) ON DELETE CASCADE,
     type        TEXT NOT NULL,
     payer_name  TEXT,
     amount      REAL NOT NULL,
     source_path TEXT,
     note        TEXT,
     sync_id     TEXT,
     updated_at  TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_tax_payments_ay ON ${T.taxPayments}(ay)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_tax_payments_sync ON ${T.taxPayments}(sync_id)`,
  `DROP TABLE IF EXISTS ${T.taxAssessment}`,
  `CREATE TABLE IF NOT EXISTS ${T.taxAssessment} (
     ay                 TEXT PRIMARY KEY NOT NULL REFERENCES ${T.taxYears}(ay) ON DELETE CASCADE,
     gross_total_income REAL,
     total_deductions   REAL,
     total_income       REAL,
     total_tax_payable  REAL,
     rebate_87a         REAL,
     education_cess     REAL,
     net_tax_liability  REAL,
     total_taxes_paid   REAL,
     refund_or_balance  REAL,
     updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `DROP TABLE IF EXISTS ${T.taxWizardAnswers}`,
  `CREATE TABLE IF NOT EXISTS ${T.taxWizardAnswers} (
     ay          TEXT PRIMARY KEY NOT NULL REFERENCES ${T.taxYears}(ay) ON DELETE CASCADE,
     answers     TEXT NOT NULL,
     recommended TEXT,
     rationale   TEXT,
     updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  // custom_options (0007).
  `DROP TABLE IF EXISTS ${T.customOptions}`,
  `CREATE TABLE IF NOT EXISTS ${T.customOptions} (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     category   TEXT NOT NULL,
     value      TEXT NOT NULL,
     label      TEXT NOT NULL,
     parent     TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT,
     UNIQUE(category, parent, value)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_custom_options_cat ON ${T.customOptions}(category, parent)`,

  // people (0009).
  `DROP TABLE IF EXISTS ${T.people}`,
  `CREATE TABLE IF NOT EXISTS ${T.people} (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL,
     relationship TEXT,
     phone        TEXT,
     email        TEXT,
     id_proof_ref TEXT,
     access_tier  INTEGER NOT NULL DEFAULT 0 CHECK (access_tier IN (0, 1, 2)),
     notes        TEXT,
     created_at   TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id      TEXT,
     updated_at   TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_people_sync ON ${T.people}(sync_id)`,

  // documents (0009).
  `DROP TABLE IF EXISTS ${T.documents}`,
  `CREATE TABLE IF NOT EXISTS ${T.documents} (
     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
     type                 TEXT NOT NULL DEFAULT 'other',
     title                TEXT NOT NULL,
     file_name            TEXT,
     mime                 TEXT,
     size                 INTEGER,
     encrypted            INTEGER NOT NULL DEFAULT 1,
     account_id           INTEGER REFERENCES ${T.accounts}(id) ON DELETE SET NULL,
     person_id            INTEGER REFERENCES ${T.people}(id)   ON DELETE SET NULL,
     issued_on            TEXT,
     expires_on           TEXT,
     location_of_original TEXT,
     notes                TEXT,
     created_at           TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id              TEXT,
     updated_at           TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_documents_account ON ${T.documents}(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mf_documents_person ON ${T.documents}(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mf_documents_type ON ${T.documents}(type)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_documents_sync ON ${T.documents}(sync_id)`,

  // reminders (0010).
  `DROP TABLE IF EXISTS ${T.reminders}`,
  `CREATE TABLE IF NOT EXISTS ${T.reminders} (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     type          TEXT NOT NULL DEFAULT 'custom',
     title         TEXT NOT NULL,
     notes         TEXT,
     due_date      TEXT NOT NULL,
     cadence       TEXT NOT NULL DEFAULT 'once' CHECK (cadence IN ('once', 'annual')),
     source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'derived')),
     dedupe_key    TEXT UNIQUE,
     status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
     snoozed_until TEXT,
     last_fired_on TEXT,
     account_id    INTEGER REFERENCES ${T.accounts}(id)  ON DELETE CASCADE,
     document_id   INTEGER REFERENCES ${T.documents}(id) ON DELETE CASCADE,
     person_id     INTEGER REFERENCES ${T.people}(id)    ON DELETE CASCADE,
     created_at    TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id       TEXT,
     updated_at    TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_reminders_status ON ${T.reminders}(status)`,
  `CREATE INDEX IF NOT EXISTS idx_mf_reminders_due ON ${T.reminders}(due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_mf_reminders_dedupe ON ${T.reminders}(dedupe_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_reminders_sync ON ${T.reminders}(sync_id)`,

  // insurance_policies (0012).
  `DROP TABLE IF EXISTS ${T.insurancePolicies}`,
  `CREATE TABLE IF NOT EXISTS ${T.insurancePolicies} (
     id                       INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id               INTEGER REFERENCES ${T.accounts}(id) ON DELETE SET NULL,
     kind                     TEXT NOT NULL DEFAULT 'other'
                                CHECK (kind IN ('term','health','accident','critical_illness',
                                                'loan','endowment','ulip','motor','home','other')),
     insurer                  TEXT NOT NULL,
     policy_no                TEXT,
     sum_assured              REAL NOT NULL DEFAULT 0,
     premium                  REAL,
     renewal_date             TEXT,
     tpa                      TEXT,
     network_hospitals        TEXT,
     claims_contact_person_id INTEGER REFERENCES ${T.people}(id) ON DELETE SET NULL,
     notes                    TEXT,
     created_at               TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id                  TEXT,
     updated_at               TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_insurance_kind ON ${T.insurancePolicies}(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_mf_insurance_renewal ON ${T.insurancePolicies}(renewal_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_insurance_policies_sync ON ${T.insurancePolicies}(sync_id)`,

  // holdings (0013).
  `DROP TABLE IF EXISTS ${T.holdings}`,
  `CREATE TABLE IF NOT EXISTS ${T.holdings} (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id       INTEGER NOT NULL REFERENCES ${T.accounts}(id) ON DELETE CASCADE,
     person_id        INTEGER NOT NULL REFERENCES ${T.people}(id)   ON DELETE CASCADE,
     role             TEXT NOT NULL DEFAULT 'nominee'
                        CHECK (role IN ('nominee', 'co_holder', 'beneficiary')),
     share_pct        REAL,
     position         INTEGER,
     sec39_beneficial INTEGER NOT NULL DEFAULT 0,
     created_at       TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id          TEXT,
     updated_at       TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_holdings_account ON ${T.holdings}(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mf_holdings_person ON ${T.holdings}(person_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_holdings_sync ON ${T.holdings}(sync_id)`,

  // will_meta (0014).
  `DROP TABLE IF EXISTS ${T.willMeta}`,
  `CREATE TABLE IF NOT EXISTS ${T.willMeta} (
     id                   INTEGER PRIMARY KEY CHECK (id = 1),
     has_will             INTEGER NOT NULL DEFAULT 0,
     executor_person_id   INTEGER REFERENCES ${T.people}(id) ON DELETE SET NULL,
     guardian_person_id   INTEGER REFERENCES ${T.people}(id) ON DELETE SET NULL,
     registered           INTEGER NOT NULL DEFAULT 0,
     registration_details TEXT,
     location_of_original TEXT,
     probate_required     INTEGER NOT NULL DEFAULT 0,
     notes                TEXT,
     updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  // incapacity_meta (0015).
  `DROP TABLE IF EXISTS ${T.incapacityMeta}`,
  `CREATE TABLE IF NOT EXISTS ${T.incapacityMeta} (
     id                     INTEGER PRIMARY KEY CHECK (id = 1),
     poa_attorney_person_id INTEGER REFERENCES ${T.people}(id) ON DELETE SET NULL,
     poa_kind               TEXT,
     poa_scope              TEXT,
     poa_registered         INTEGER NOT NULL DEFAULT 0,
     poa_revoked            INTEGER NOT NULL DEFAULT 0,
     amd_life_support       TEXT,
     amd_resuscitation      TEXT,
     amd_organ_donation     INTEGER NOT NULL DEFAULT 0,
     amd_attestation        TEXT,
     notes                  TEXT,
     updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  // access_grants + audit_log (0016).
  `DROP TABLE IF EXISTS ${T.accessGrants}`,
  `CREATE TABLE IF NOT EXISTS ${T.accessGrants} (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     person_id  INTEGER NOT NULL REFERENCES ${T.people}(id) ON DELETE CASCADE,
     tier       INTEGER NOT NULL DEFAULT 0 CHECK (tier IN (0, 1, 2)),
     scope      TEXT,
     trigger    TEXT NOT NULL DEFAULT 'manual',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id    TEXT,
     updated_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_access_person ON ${T.accessGrants}(person_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_access_grants_sync ON ${T.accessGrants}(sync_id)`,
  `DROP TABLE IF EXISTS ${T.auditLog}`,
  `CREATE TABLE IF NOT EXISTS ${T.auditLog} (
     id     INTEGER PRIMARY KEY AUTOINCREMENT,
     at     TEXT NOT NULL DEFAULT (datetime('now')),
     action TEXT NOT NULL,
     detail TEXT
   )`,

  // life_events (0017).
  `DROP TABLE IF EXISTS ${T.lifeEvents}`,
  `CREATE TABLE IF NOT EXISTS ${T.lifeEvents} (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     type       TEXT NOT NULL,
     event_date TEXT,
     notes      TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     sync_id    TEXT,
     updated_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_life_events_date ON ${T.lifeEvents}(event_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_life_events_sync ON ${T.lifeEvents}(sync_id)`,

  // app_launches (0018).
  `DROP TABLE IF EXISTS ${T.appLaunches}`,
  `CREATE TABLE IF NOT EXISTS ${T.appLaunches} (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     launched_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  // master_options (0019).
  `DROP TABLE IF EXISTS ${T.masterOptions}`,
  `CREATE TABLE IF NOT EXISTS ${T.masterOptions} (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     master_id  TEXT NOT NULL,
     value      TEXT NOT NULL,
     label      TEXT NOT NULL,
     icon       TEXT,
     parent     TEXT,
     version    INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(master_id, parent, value)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_master_options_mid ON ${T.masterOptions}(master_id, parent)`,

  // partners (0020).
  `DROP TABLE IF EXISTS ${T.partners}`,
  `CREATE TABLE IF NOT EXISTS ${T.partners} (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     professional_type TEXT NOT NULL,
     name              TEXT NOT NULL,
     phone             TEXT,
     email             TEXT,
     notes             TEXT,
     icon              TEXT,
     version           INTEGER NOT NULL DEFAULT 0,
     updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE(professional_type, name)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mf_partners_type ON ${T.partners}(professional_type)`,

  // sync_tombstones (0021) — namespaced deletion log.
  `DROP TABLE IF EXISTS ${T.syncTombstones}`,
  `CREATE TABLE IF NOT EXISTS ${T.syncTombstones} (
     table_name TEXT NOT NULL,
     key        TEXT NOT NULL,
     deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (table_name, key)
   )`,

  // Legacy 0001 settings seed + 0021 device_id seed.
  `INSERT OR IGNORE INTO ${T.settings} (key, value) VALUES
     ('currency', 'INR'),
     ('fy_start_month', '4'),
     ('date_format', 'DD/MM/YYYY'),
     ('theme', 'system')`,
  `INSERT OR IGNORE INTO ${T.settings} (key, value)
     VALUES ('device_id', lower(hex(randomblob(16))))`,
];

/**
 * UUID-identity tables (keyed on sync_id) and natural-key tables: the 0021/0022
 * trigger suite — AFTER INSERT backfill of sync_id/updated_at, AFTER UPDATE
 * "touch" of updated_at (guarded WHEN NEW.updated_at = OLD.updated_at so a
 * sync-apply that writes the REMOTE timestamp is preserved), and AFTER DELETE
 * tombstones. Rewritten against the namespaced tables. The tombstone `key` and
 * `table_name` values keep the LEGACY (un-namespaced) identity so the sync
 * merge engine — which addresses rows by their logical table name — matches.
 */
const syncTriggers = (): string[] => {
  // (suite table, logical name used in tombstone rows, key-expr for tombstone).
  const out: string[] = [];

  // UUID tables: ins-backfill + touch + sync_id tombstone.
  const uuid: Array<[string, string]> = [
    [T.accounts, "accounts"],
    [T.goals, "goals"],
    [T.vaultEntries, "vault_entries"],
    [T.people, "people"],
    [T.documents, "documents"],
    [T.reminders, "reminders"],
    [T.insurancePolicies, "insurance_policies"],
    [T.holdings, "holdings"],
    [T.accessGrants, "access_grants"],
    [T.lifeEvents, "life_events"],
    [T.taxIncome, "tax_income"],
    [T.taxDeductions, "tax_deductions"],
    [T.taxPayments, "tax_payments"],
  ];
  for (const [tbl, logical] of uuid) {
    const trg = tbl.replace(/[^A-Za-z0-9_]/g, "_");
    out.push(
      `CREATE TRIGGER IF NOT EXISTS trg_${trg}_ins AFTER INSERT ON ${tbl} FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
       BEGIN UPDATE ${tbl} SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END`,
      `CREATE TRIGGER IF NOT EXISTS trg_${trg}_touch AFTER UPDATE ON ${tbl} FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
       BEGIN UPDATE ${tbl} SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END`,
      `CREATE TRIGGER IF NOT EXISTS trg_${trg}_tomb AFTER DELETE ON ${tbl} FOR EACH ROW
       BEGIN INSERT OR REPLACE INTO ${T.syncTombstones}(table_name, key, deleted_at) VALUES('${logical}', OLD.sync_id, datetime('now')); END`,
    );
  }

  // custom_options: ins-backfill (updated_at only) + touch + natural-key tombstone.
  {
    const tbl = T.customOptions;
    const trg = tbl.replace(/[^A-Za-z0-9_]/g, "_");
    out.push(
      `CREATE TRIGGER IF NOT EXISTS trg_${trg}_ins AFTER INSERT ON ${tbl} FOR EACH ROW WHEN NEW.updated_at IS NULL
       BEGIN UPDATE ${tbl} SET updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END`,
      `CREATE TRIGGER IF NOT EXISTS trg_${trg}_touch AFTER UPDATE ON ${tbl} FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
       BEGIN UPDATE ${tbl} SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END`,
      `CREATE TRIGGER IF NOT EXISTS trg_${trg}_tomb AFTER DELETE ON ${tbl} FOR EACH ROW
       BEGIN INSERT OR REPLACE INTO ${T.syncTombstones}(table_name, key, deleted_at)
         VALUES('custom_options', OLD.category || '|' || COALESCE(OLD.parent, '') || '|' || OLD.value, datetime('now')); END`,
    );
  }

  // updated_at touch on tables that have updated_at but no sync_id (single-row /
  // natural-key tables). monthly_snapshot + tax_years get natural-key tombstones too.
  const touchOnly: string[] = [
    T.monthlySnapshot, T.taxYears, T.taxAssessment, T.taxWizardAnswers,
    T.willMeta, T.incapacityMeta,
  ];
  for (const tbl of touchOnly) {
    const trg = tbl.replace(/[^A-Za-z0-9_]/g, "_");
    out.push(
      `CREATE TRIGGER IF NOT EXISTS trg_${trg}_touch AFTER UPDATE ON ${tbl} FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
       BEGIN UPDATE ${tbl} SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END`,
    );
  }

  // monthly_snapshot natural-key tombstone — composite (account sync_id | month).
  // Mirrors the 0021/0022 pattern; reads the namespaced accounts table.
  out.push(
    `CREATE TRIGGER IF NOT EXISTS trg_${T.monthlySnapshot.replace(/[^A-Za-z0-9_]/g, "_")}_tomb AFTER DELETE ON ${T.monthlySnapshot} FOR EACH ROW
     BEGIN
       INSERT OR REPLACE INTO ${T.syncTombstones}(table_name, key, deleted_at)
       SELECT 'monthly_snapshot', a.sync_id || '|' || OLD.month, datetime('now')
       FROM ${T.accounts} a WHERE a.id = OLD.account_id;
     END`,
  );

  // tax_years natural-key tombstone (keyed on ay).
  out.push(
    `CREATE TRIGGER IF NOT EXISTS trg_${T.taxYears.replace(/[^A-Za-z0-9_]/g, "_")}_tomb AFTER DELETE ON ${T.taxYears} FOR EACH ROW
     BEGIN INSERT OR REPLACE INTO ${T.syncTombstones}(table_name, key, deleted_at) VALUES('tax_years', OLD.ay, datetime('now')); END`,
  );

  return out;
};

/**
 * The full aux-SQL migration set, applied (append-only, idempotent) via
 * `registerAuxMigrations(db, "myfinance", MYFINANCE_AUX_MIGRATIONS)` AFTER
 * `registerSchemas`. v1 = canonical tables; v2 = sync trigger suite.
 */
export const MYFINANCE_AUX_MIGRATIONS: AuxMigrationStep[] = [
  { version: 1, sql: CANONICAL_TABLES },
  { version: 2, sql: syncTriggers() },
];
