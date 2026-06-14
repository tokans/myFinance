-- Add an optional maturity date to accounts. Only meaningful for term products
-- (fixed deposits); null for everything else. Stored as a 'YYYY-MM-DD' string,
-- matching the app's other date conventions. A plain ADD COLUMN suffices here —
-- no CHECK constraint changes, so the accounts table need not be rebuilt.

ALTER TABLE accounts ADD COLUMN maturity_date TEXT;
