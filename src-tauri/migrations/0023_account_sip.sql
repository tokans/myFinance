-- SIP (Systematic Investment Plan) fields for Mutual Funds accounts.
--
-- A SIP debits a fixed amount on the same day each month. We track:
--   sip_day       — debit day-of-month (1..31), NULL when the account has no SIP.
--                   Days past a month's length are clamped at read time (e.g. 31 -> 28/29).
--   sip_amount    — optional installment amount, used only to enrich the reminder text.
--   sip_last_done — 'YYYY-MM-DD' of the most recent SIP occurrence the user marked
--                   Done/Ignore. This is the cycle marker that drives the monthly
--                   roll-forward of the derived "SIP due" reminder.
--
-- Only meaningful for accounts of type 'mutual_funds'; NULL for everything else. Plain
-- ADD COLUMNs suffice (no CHECK constraint changes) so the accounts table is NOT rebuilt,
-- matching 0006_account_maturity_date.sql. The 0021 sync triggers on accounts are
-- unaffected by adding columns.

ALTER TABLE accounts ADD COLUMN sip_day       INTEGER;
ALTER TABLE accounts ADD COLUMN sip_amount    REAL;
ALTER TABLE accounts ADD COLUMN sip_last_done TEXT;
