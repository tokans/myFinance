-- Estate-readiness Phase 5: nominees / co-holders (Feature 2) + holding mode.
-- `holdings` links an account to a person with a role and (for nominees) a share.
-- `accounts.holding_mode` records how the account operates, feeding the Phase 8
-- liquidity view.

ALTER TABLE accounts ADD COLUMN holding_mode TEXT;  -- single / joint / either_or_survivor / former_or_survivor

CREATE TABLE IF NOT EXISTS holdings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  person_id         INTEGER NOT NULL REFERENCES people(id)   ON DELETE CASCADE,
  role              TEXT NOT NULL DEFAULT 'nominee'
                      CHECK (role IN ('nominee', 'co_holder', 'beneficiary')),
  share_pct         REAL,
  position          INTEGER,
  -- Sec 39 Insurance Act "beneficial nominee" (parent/spouse/child) flag.
  sec39_beneficial  INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_person  ON holdings(person_id);
