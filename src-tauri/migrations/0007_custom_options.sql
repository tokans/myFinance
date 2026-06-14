-- Generic store for user-added "Other" values on finite-set inputs (country,
-- city, institution, currency, life-goal categories, …). The app ships baked
-- static masters; rows here are the user's own additions, merged on top so the
-- master grows over time. Keyed by `category` (the master id) plus an optional
-- `parent` for dependent sets (e.g. a city belongs to a country code).

CREATE TABLE custom_options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  category   TEXT NOT NULL,           -- master id: 'country','city','institution','currency','life_goal'
  value      TEXT NOT NULL,           -- canonical stored value
  label      TEXT NOT NULL,           -- display label
  parent     TEXT,                    -- dependency key (e.g. city -> country code); NULL otherwise
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, parent, value)
);

CREATE INDEX idx_custom_options_cat ON custom_options(category, parent);
