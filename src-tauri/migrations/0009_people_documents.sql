-- Estate-readiness foundation (Phase 1): People + Documents.
--
-- These two tables are the backbone the later phases hang off:
--   people    -- family / executor / nominee / doctor / RM, with relationship + access tier
--   documents -- typed legal/financial files (Will, PoA, AMD, policy, statement, ID card, …)
--
-- Document binaries are NOT stored here. They live encrypted on disk under
-- $APPDATA/documents/<uuid>; this table only holds metadata and the file name.
-- See src/vault/documentFiles.ts for the AES-256-GCM sealing.

CREATE TABLE IF NOT EXISTS people (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  relationship  TEXT,
  phone         TEXT,
  email         TEXT,
  id_proof_ref  TEXT,
  -- Progressive-access tier (Feature 9): 0 = always-visible emergency contact,
  -- 1 = summary access, 2 = full register. Defaults to 0.
  access_tier   INTEGER NOT NULL DEFAULT 0 CHECK (access_tier IN (0, 1, 2)),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  type                 TEXT NOT NULL DEFAULT 'other',
  title                TEXT NOT NULL,
  -- Relative file name under $APPDATA/documents/. NULL for a metadata-only record
  -- (e.g. "physical original in bank locker" with no scan attached).
  file_name            TEXT,
  mime                 TEXT,
  size                 INTEGER,
  -- 1 when the on-disk blob is AES-GCM sealed (the default and only path today).
  encrypted            INTEGER NOT NULL DEFAULT 1,
  account_id           INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  person_id            INTEGER REFERENCES people(id)   ON DELETE SET NULL,
  issued_on            TEXT,
  expires_on           TEXT,
  location_of_original TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_account ON documents(account_id);
CREATE INDEX IF NOT EXISTS idx_documents_person  ON documents(person_id);
CREATE INDEX IF NOT EXISTS idx_documents_type    ON documents(type);
