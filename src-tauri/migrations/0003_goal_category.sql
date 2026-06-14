-- Add life-goal template category to goals.
-- Nullable: pre-existing and custom goals simply have no category.
ALTER TABLE goals ADD COLUMN category TEXT;
