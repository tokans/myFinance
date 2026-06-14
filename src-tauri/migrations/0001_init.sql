-- Core schema, version 1.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

-- Optional encrypted credential vault pointers.
-- The actual ciphertext lives in Stronghold; this table only stores
-- a friendly label and the Stronghold record key.
CREATE TABLE IF NOT EXISTS vault_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT NOT NULL,
  stronghold_key  TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('bank','cash','credit','investment','loan','other')),
  institution     TEXT,
  currency        TEXT NOT NULL DEFAULT 'INR',
  opening_balance REAL NOT NULL DEFAULT 0,
  credential_id   INTEGER REFERENCES vault_entries(id) ON DELETE SET NULL,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_archived ON accounts(is_archived);

-- One row per (account, month). month stored as 'YYYY-MM' for cheap range queries.
CREATE TABLE IF NOT EXISTS monthly_snapshot (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  value       REAL NOT NULL,
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, month)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_month ON monthly_snapshot(month);
CREATE INDEX IF NOT EXISTS idx_snapshot_account_month ON monthly_snapshot(account_id, month);

CREATE TABLE IF NOT EXISTS goals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  target_amount   REAL NOT NULL,
  target_date     TEXT,
  baseline_month  TEXT,
  account_filter  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT
);

-- Seed default settings. Application overwrites these once the user saves.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('currency',        'INR'),
  ('fy_start_month',  '4'),
  ('date_format',     'DD/MM/YYYY'),
  ('theme',           'system');
