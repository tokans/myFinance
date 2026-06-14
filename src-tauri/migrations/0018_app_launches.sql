-- Usage telemetry (local-only): one row per app launch.
--
-- Powers the hidden usage screen (Ctrl+Shift+Alt+1) and the gamification tier
-- shown on the dashboard. Stored on-device like everything else — never sent
-- anywhere. `launched_at` is a UTC datetime; the day is derived client-side so
-- distinct-day streaks reflect the user's local calendar.

CREATE TABLE IF NOT EXISTS app_launches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  launched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
