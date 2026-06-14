-- Professional "partners": a curated directory of named professionals (or firms)
-- the user can pick from when adding a professional contact — e.g. a panel of
-- partner doctors, lawyers, chartered accountants. Like `master_options`, this is
-- a "remote" layer: reference data pushed independently of the binary, signature-
-- and hash-verified and decrypted on the Rust side, then upserted here. It ships
-- EMPTY; when no partners exist for a professional type the Add-People UX is
-- unchanged. Unlike master_options, a partner carries contact fields so selecting
-- one can auto-fill the person form. Keyed by `professional_type` (which matches a
-- value from the `professional_type` master, e.g. 'Doctor').
-- See docs/plans/master-and-app-updates.md.

CREATE TABLE partners (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  professional_type TEXT NOT NULL,           -- e.g. 'Doctor', 'Lawyer', 'Chartered Accountant'
  name              TEXT NOT NULL,           -- person or firm name
  phone             TEXT,                    -- optional contact, used to auto-fill
  email             TEXT,                    -- optional contact, used to auto-fill
  notes             TEXT,                    -- optional blurb (speciality, location)
  icon              TEXT,                    -- optional leading glyph
  version           INTEGER NOT NULL DEFAULT 0, -- manifest revision this row was applied from
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(professional_type, name)
);

CREATE INDEX idx_partners_type ON partners(professional_type);
