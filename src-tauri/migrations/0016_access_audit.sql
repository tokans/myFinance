-- Estate-readiness Phase 9: progressive access grants + audit log (Feature 9).
-- Live remote / dead-man's-switch access needs a backend, so triggers here are
-- local: manual unlock + a "last check-in" staleness flag (stored in settings).
-- Tier-2 reveals are exported as a passphrase-encrypted package, every export
-- recorded in the audit log.

CREATE TABLE IF NOT EXISTS access_grants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tier        INTEGER NOT NULL DEFAULT 0 CHECK (tier IN (0, 1, 2)),
  scope       TEXT,
  trigger     TEXT NOT NULL DEFAULT 'manual',  -- 'manual' / 'staleness'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_access_person ON access_grants(person_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  action  TEXT NOT NULL,
  detail  TEXT
);
