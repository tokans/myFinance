-- Add 'pms_aif' (Portfolio Management Services / Alternative Investment Funds)
-- to the account-type vocabulary. Like 0004 this relaxes the CHECK constraint,
-- which requires rebuilding the accounts table; monthly_snapshot is backed up
-- and restored with INSERT OR IGNORE so it is safe whether foreign-key
-- enforcement is ON (cascade empties it) or OFF (no-op) -- no data loss.

CREATE TABLE _snap_bak AS SELECT * FROM monthly_snapshot;

CREATE TABLE accounts_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN (
                    'bank_savings','checking','cash','fixed_deposit','recurring_deposit',
                    'ppf','epf','nps','stocks','mutual_funds','etf','bonds','pms_aif',
                    'gold','real_estate','crypto','loan','credit_card','insurance','other')),
  institution     TEXT,
  currency        TEXT NOT NULL DEFAULT 'INR',
  opening_balance REAL NOT NULL DEFAULT 0,
  credential_id   INTEGER REFERENCES vault_entries(id) ON DELETE SET NULL,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  type_note       TEXT
);

INSERT INTO accounts_new
  (id, name, type, institution, currency, opening_balance, credential_id, is_archived, created_at, type_note)
SELECT
  id, name, type, institution, currency, opening_balance, credential_id, is_archived, created_at, type_note
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX IF NOT EXISTS idx_accounts_archived ON accounts(is_archived);

INSERT OR IGNORE INTO monthly_snapshot
  (id, account_id, month, value, note, source, updated_at)
SELECT id, account_id, month, value, note, source, updated_at FROM _snap_bak;

DROP TABLE _snap_bak;
