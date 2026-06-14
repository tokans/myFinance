-- Estate-readiness Phase 4: insurance policies (Feature 5).
-- A dedicated table (owner decision) rather than bloating `accounts`. Optionally
-- linked to an account; claims contact links to a person.

CREATE TABLE IF NOT EXISTS insurance_policies (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id                INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  kind                      TEXT NOT NULL DEFAULT 'other'
                              CHECK (kind IN ('term','health','accident','critical_illness',
                                              'loan','endowment','ulip','motor','home','other')),
  insurer                   TEXT NOT NULL,
  policy_no                 TEXT,
  sum_assured               REAL NOT NULL DEFAULT 0,
  premium                   REAL,
  renewal_date              TEXT,
  tpa                       TEXT,
  network_hospitals         TEXT,
  claims_contact_person_id  INTEGER REFERENCES people(id) ON DELETE SET NULL,
  notes                     TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insurance_kind    ON insurance_policies(kind);
CREATE INDEX IF NOT EXISTS idx_insurance_renewal ON insurance_policies(renewal_date);
