-- Estate-readiness / "Prepare for Emergencies" fields on accounts.
--
-- Two optional free-text columns so a family member can act without the user:
--   contact          -- who to reach (name + phone/email), used for click-to-call
--   emergency_action -- what to do for this account in an emergency
--
-- Both are nullable and have no CHECK constraints, so a plain ADD COLUMN is
-- enough — the accounts table need not be rebuilt. Mirrors the maturity_date
-- migration (0006) in style.

ALTER TABLE accounts ADD COLUMN contact TEXT;
ALTER TABLE accounts ADD COLUMN emergency_action TEXT;
