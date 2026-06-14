-- Estate-readiness Phase 3: hospitalisation-ready health profile (Feature 8).
-- A single-row table (id is pinned to 1) holding the grab-and-go medical facts
-- that go on the ICE (In Case of Emergency) card. Doctors and emergency contacts
-- live in `people`; ID/insurance card scans live in `documents`.

CREATE TABLE IF NOT EXISTS health_profile (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  full_name          TEXT,
  blood_group        TEXT,
  allergies          TEXT,
  chronic_conditions TEXT,
  medications        TEXT,
  organ_donor        INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
