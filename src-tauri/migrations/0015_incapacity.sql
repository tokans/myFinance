-- Estate-readiness Phase 7: Power of Attorney + Advance Medical Directive
-- (Feature 4). Single-row metadata; the PoA/AMD documents live in `documents`
-- (types 'poa'/'amd').

CREATE TABLE IF NOT EXISTS incapacity_meta (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  poa_attorney_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  poa_kind               TEXT,    -- 'general' / 'specific'
  poa_scope              TEXT,
  poa_registered         INTEGER NOT NULL DEFAULT 0,
  poa_revoked            INTEGER NOT NULL DEFAULT 0,
  amd_life_support       TEXT,
  amd_resuscitation      TEXT,
  amd_organ_donation     INTEGER NOT NULL DEFAULT 0,
  amd_attestation        TEXT,
  notes                  TEXT,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
