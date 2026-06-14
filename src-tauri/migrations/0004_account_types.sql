-- Expand the account-type vocabulary (6 coarse types -> 19 granular ones) and
-- add a free-text note for the "Others" choice.
--
-- Relaxing the CHECK constraint on accounts.type means rebuilding the table.
-- monthly_snapshot FKs into accounts ON DELETE CASCADE, so dropping the parent
-- empties it when foreign-key enforcement is ON. We back the rows up first and
-- restore with INSERT OR IGNORE, which is also a no-op when enforcement is OFF
-- (rows survive the drop) -- correct under either setting, no data loss.

CREATE TABLE _snap_bak AS SELECT * FROM monthly_snapshot;

CREATE TABLE accounts_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN (
                    'bank_savings','checking','cash','fixed_deposit','recurring_deposit',
                    'ppf','epf','nps','stocks','mutual_funds','etf','bonds',
                    'gold','real_estate','crypto','loan','credit_card','insurance','other')),
  institution     TEXT,
  currency        TEXT NOT NULL DEFAULT 'INR',
  opening_balance REAL NOT NULL DEFAULT 0,
  credential_id   INTEGER REFERENCES vault_entries(id) ON DELETE SET NULL,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  type_note       TEXT
);

-- Remap legacy values onto the closest new key; unknown/unchanged fall through.
INSERT INTO accounts_new
  (id, name, type, institution, currency, opening_balance, credential_id, is_archived, created_at, type_note)
SELECT
  id, name,
  CASE type
    WHEN 'bank'       THEN 'bank_savings'
    WHEN 'credit'     THEN 'credit_card'
    WHEN 'investment' THEN 'stocks'
    ELSE type  -- 'cash', 'loan', 'other' carry over unchanged
  END,
  institution, currency, opening_balance, credential_id, is_archived, created_at, NULL
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX IF NOT EXISTS idx_accounts_archived ON accounts(is_archived);

INSERT OR IGNORE INTO monthly_snapshot
  (id, account_id, month, value, note, source, updated_at)
SELECT id, account_id, month, value, note, source, updated_at FROM _snap_bak;

DROP TABLE _snap_bak;
