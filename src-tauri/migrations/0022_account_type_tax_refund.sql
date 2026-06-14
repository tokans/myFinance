-- Add 'tax_refund' to the account-type vocabulary. Like 0004/0005 this relaxes
-- the CHECK constraint on accounts.type, which SQLite can only do by rebuilding
-- the table. monthly_snapshot is backed up and restored with INSERT OR IGNORE so
-- it is safe whether foreign-key enforcement is ON (the drop cascades and empties
-- it) or OFF (rows survive) -- no data loss.
--
-- NEW vs 0004/0005: by the time this runs, 0021 has put sync_id/updated_at
-- columns, a UNIQUE sync index, and INSERT/UPDATE/DELETE sync triggers on
-- accounts. DROP TABLE removes the table's own indexes and triggers, so they are
-- recreated verbatim below.
--
-- Crucially, the FK cascade that empties monthly_snapshot when accounts is
-- dropped DOES fire monthly_snapshot's AFTER DELETE tombstone trigger, whose
-- body reads from `accounts` -- which by then no longer exists, so the migration
-- would fail outright (and, if it didn't, every snapshot would get a spurious
-- delete tombstone that sync would replay as a real deletion). So we drop that
-- trigger up front and recreate it verbatim after the rebuild.

DROP TRIGGER IF EXISTS trg_monthly_snapshot_tomb;

CREATE TABLE _snap_bak AS SELECT * FROM monthly_snapshot;

CREATE TABLE accounts_new (
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
  credential_id   INTEGER REFERENCES vault_entries(id) ON DELETE SET NULL,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  type_note       TEXT,
  maturity_date   TEXT,
  contact         TEXT,
  emergency_action TEXT,
  holding_mode    TEXT,
  sync_id         TEXT,
  updated_at      TEXT
);

INSERT INTO accounts_new
  (id, name, type, institution, currency, opening_balance, credential_id,
   is_archived, created_at, type_note, maturity_date, contact, emergency_action,
   holding_mode, sync_id, updated_at)
SELECT
  id, name, type, institution, currency, opening_balance, credential_id,
  is_archived, created_at, type_note, maturity_date, contact, emergency_action,
  holding_mode, sync_id, updated_at
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

-- Recreate indexes dropped with the old table (0004 + 0021).
CREATE INDEX IF NOT EXISTS idx_accounts_archived ON accounts(is_archived);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_sync ON accounts(sync_id);

-- Recreate the sync triggers dropped with the old table (verbatim from 0021).
CREATE TRIGGER IF NOT EXISTS trg_accounts_ins AFTER INSERT ON accounts FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE accounts SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_accounts_touch AFTER UPDATE ON accounts FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE accounts SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_accounts_tomb AFTER DELETE ON accounts FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('accounts', OLD.sync_id, datetime('now')); END;

INSERT OR IGNORE INTO monthly_snapshot
  (id, account_id, month, value, note, source, updated_at)
SELECT id, account_id, month, value, note, source, updated_at FROM _snap_bak;

DROP TABLE _snap_bak;

-- Recreate the snapshot tombstone trigger dropped above (verbatim from 0021).
CREATE TRIGGER IF NOT EXISTS trg_monthly_snapshot_tomb AFTER DELETE ON monthly_snapshot FOR EACH ROW
BEGIN
  INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at)
  SELECT 'monthly_snapshot', a.sync_id || '|' || OLD.month, datetime('now')
  FROM accounts a WHERE a.id = OLD.account_id;
END;
