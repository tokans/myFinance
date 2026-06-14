-- Tax records, keyed by assessment year (e.g. 'AY2026-27').

CREATE TABLE IF NOT EXISTS tax_years (
  ay                  TEXT PRIMARY KEY NOT NULL,
  itr_form            TEXT,             -- '1','2','3','4' or NULL when undetermined
  itr_form_source     TEXT,             -- 'manual','import','wizard'
  imported_filename   TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_income (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ay          TEXT NOT NULL REFERENCES tax_years(ay) ON DELETE CASCADE,
  head        TEXT NOT NULL,            -- 'salary','house_property','other_sources','cg_short','cg_long','business','exempt'
  label       TEXT NOT NULL,
  amount      REAL NOT NULL,
  source_path TEXT,                     -- JSON path when imported
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tax_income_ay ON tax_income(ay);

CREATE TABLE IF NOT EXISTS tax_deductions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ay          TEXT NOT NULL REFERENCES tax_years(ay) ON DELETE CASCADE,
  section     TEXT NOT NULL,            -- '80C','80D','80G', etc.
  label       TEXT NOT NULL,
  amount      REAL NOT NULL,
  source_path TEXT,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tax_deductions_ay ON tax_deductions(ay);

CREATE TABLE IF NOT EXISTS tax_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ay          TEXT NOT NULL REFERENCES tax_years(ay) ON DELETE CASCADE,
  type        TEXT NOT NULL,            -- 'tds_salary','tds_other','advance','self_assessment','tcs'
  payer_name  TEXT,
  amount      REAL NOT NULL,
  source_path TEXT,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tax_payments_ay ON tax_payments(ay);

CREATE TABLE IF NOT EXISTS tax_assessment (
  ay                  TEXT PRIMARY KEY NOT NULL REFERENCES tax_years(ay) ON DELETE CASCADE,
  gross_total_income  REAL,
  total_deductions    REAL,
  total_income        REAL,
  total_tax_payable   REAL,
  rebate_87a          REAL,
  education_cess      REAL,
  net_tax_liability   REAL,
  total_taxes_paid    REAL,
  refund_or_balance   REAL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-AY answers to the recommendation wizard (so we don't ask again).
CREATE TABLE IF NOT EXISTS tax_wizard_answers (
  ay          TEXT PRIMARY KEY NOT NULL REFERENCES tax_years(ay) ON DELETE CASCADE,
  answers     TEXT NOT NULL,            -- JSON blob: { hasBusinessIncome: true, ... }
  recommended TEXT,                     -- '1','2','3','4'
  rationale   TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
