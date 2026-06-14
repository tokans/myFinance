-- Estate-readiness Phase 2: reminders.
--
-- One table backs both user-created reminders and "derived" ones synced from
-- existing data (FD maturity dates, document expiry; later: policy renewals,
-- stale nominees). Derived rows carry a stable `dedupe_key` so re-syncing on
-- each app open refreshes the due date/title without duplicating or clobbering
-- the user's snooze/done state.

CREATE TABLE IF NOT EXISTS reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Category for display + grouping: 'fd_maturity', 'doc_expiry', 'review',
  -- 'custom', 'policy_renewal', 'nominee_review', …
  type          TEXT NOT NULL DEFAULT 'custom',
  title         TEXT NOT NULL,
  notes         TEXT,
  -- 'YYYY-MM-DD' date the reminder is due.
  due_date      TEXT NOT NULL,
  -- 'once' or 'annual'. Annual reminders advance a year when completed.
  cadence       TEXT NOT NULL DEFAULT 'once' CHECK (cadence IN ('once', 'annual')),
  -- 'manual' (user-created) or 'derived' (synced from other tables).
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'derived')),
  -- Stable identity for a derived reminder (e.g. 'fd:42'); NULL for manual ones.
  dedupe_key    TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  -- When set (YYYY-MM-DD), the reminder is hidden until this date.
  snoozed_until TEXT,
  -- Last date we raised an OS notification for it, to avoid re-notifying daily.
  last_fired_on TEXT,
  account_id    INTEGER REFERENCES accounts(id)  ON DELETE CASCADE,
  document_id   INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  person_id     INTEGER REFERENCES people(id)    ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_status   ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_due       ON reminders(due_date);
CREATE INDEX IF NOT EXISTS idx_reminders_dedupe    ON reminders(dedupe_key);
