-- Estate-readiness Phase 6: Will metadata (Feature 3). Single-row table.
-- Will documents themselves live in `documents` (types will/codicil/probate);
-- Will beneficiaries are `holdings` rows with role 'beneficiary'.

CREATE TABLE IF NOT EXISTS will_meta (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  has_will             INTEGER NOT NULL DEFAULT 0,
  executor_person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
  guardian_person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
  registered           INTEGER NOT NULL DEFAULT 0,
  registration_details TEXT,
  location_of_original TEXT,
  probate_required     INTEGER NOT NULL DEFAULT 0,
  notes                TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
