-- Estate-readiness Phase 10: life events (Feature 10). Each event drives a
-- tailored review checklist (computed in domain/review.ts).

CREATE TABLE IF NOT EXISTS life_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  event_date  TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_life_events_date ON life_events(event_date);
