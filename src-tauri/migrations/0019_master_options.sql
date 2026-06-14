-- Over-the-air master options: reference data pushed independently of the app
-- binary, fetched from GitHub Releases, signature- + hash-verified and decrypted
-- on the Rust side, then upserted here. This is the "remote" source that layers
-- between the baked static masters (shipped in the binary) and the user's own
-- `custom_options` additions. Keyed by `master_id` plus an optional `parent` for
-- dependent sets (e.g. a city belongs to a country code), mirroring custom_options.
-- See docs/plans/master-and-app-updates.md.

CREATE TABLE master_options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id  TEXT NOT NULL,           -- master id: 'country','city','institution','currency','life_goal','relationship'
  value      TEXT NOT NULL,           -- canonical stored value
  label      TEXT NOT NULL,           -- display label
  icon       TEXT,                    -- optional leading glyph (e.g. flag emoji)
  parent     TEXT,                    -- dependency key (e.g. city -> country code); NULL otherwise
  version    INTEGER NOT NULL DEFAULT 0, -- manifest revision this row was applied from
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(master_id, parent, value)
);

CREATE INDEX idx_master_options_mid ON master_options(master_id, parent);
