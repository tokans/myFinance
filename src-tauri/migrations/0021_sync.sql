-- Device-to-device sync foundation.
--
-- Adds, to every user-data table, the two columns a two-way last-writer-wins
-- merge needs: a stable cross-device identity (`sync_id`) and a `updated_at`
-- clock. Deletions are recorded in `sync_tombstones` so a delete on one device
-- propagates to the other instead of being resurrected on the next merge.
--
-- Design notes:
--  * SQLite's ALTER TABLE ADD COLUMN forbids non-constant defaults, so the new
--    columns are added NULL, backfilled once here, and then kept populated by
--    AFTER INSERT triggers (so existing INSERT code paths need no changes).
--  * `updated_at` is auto-maintained by an AFTER UPDATE "touch" trigger guarded
--    with `WHEN NEW.updated_at = OLD.updated_at`: a normal edit (which never
--    sets updated_at) gets bumped to now; a sync-apply that writes the REMOTE
--    timestamp explicitly is left alone, so LWW ordering survives the round-trip
--    and there is no ping-pong. The guard also makes the trigger safe under
--    recursive_triggers=ON (the recursive fire sees NEW != OLD and stops).
--  * datetime('now') (second precision) is used everywhere to match the existing
--    created_at / updated_at columns; sub-second ties are broken by device id in
--    the TS merge engine.
--  * Local-only tables (app_launches, audit_log, settings) are intentionally
--    NOT synced and get none of this.

-- Tombstone log + this device's stable id (used as the LWW tie-breaker).
CREATE TABLE IF NOT EXISTS sync_tombstones (
  table_name TEXT NOT NULL,
  key        TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (table_name, key)
);

INSERT OR IGNORE INTO settings (key, value)
  VALUES ('device_id', lower(hex(randomblob(16))));

------------------------------------------------------------------------------
-- 1. sync_id on UUID-identity tables (backfill + unique index).
------------------------------------------------------------------------------
ALTER TABLE accounts            ADD COLUMN sync_id TEXT;
ALTER TABLE goals               ADD COLUMN sync_id TEXT;
ALTER TABLE vault_entries       ADD COLUMN sync_id TEXT;
ALTER TABLE people              ADD COLUMN sync_id TEXT;
ALTER TABLE documents           ADD COLUMN sync_id TEXT;
ALTER TABLE reminders           ADD COLUMN sync_id TEXT;
ALTER TABLE insurance_policies  ADD COLUMN sync_id TEXT;
ALTER TABLE holdings            ADD COLUMN sync_id TEXT;
ALTER TABLE access_grants       ADD COLUMN sync_id TEXT;
ALTER TABLE life_events         ADD COLUMN sync_id TEXT;
ALTER TABLE tax_income          ADD COLUMN sync_id TEXT;
ALTER TABLE tax_deductions      ADD COLUMN sync_id TEXT;
ALTER TABLE tax_payments        ADD COLUMN sync_id TEXT;

UPDATE accounts           SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE goals              SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE vault_entries      SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE people             SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE documents          SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE reminders          SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE insurance_policies SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE holdings           SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE access_grants      SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE life_events        SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE tax_income         SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE tax_deductions     SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;
UPDATE tax_payments       SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_sync           ON accounts(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_sync              ON goals(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_entries_sync      ON vault_entries(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_sync             ON people(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_sync          ON documents(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_sync          ON reminders(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_policies_sync ON insurance_policies(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_sync           ON holdings(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_grants_sync      ON access_grants(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_life_events_sync        ON life_events(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_income_sync         ON tax_income(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_deductions_sync     ON tax_deductions(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_payments_sync       ON tax_payments(sync_id);

------------------------------------------------------------------------------
-- 2. updated_at on tables that lack it (backfill from created_at when present).
------------------------------------------------------------------------------
ALTER TABLE accounts            ADD COLUMN updated_at TEXT;
ALTER TABLE goals               ADD COLUMN updated_at TEXT;
ALTER TABLE vault_entries       ADD COLUMN updated_at TEXT;
ALTER TABLE people              ADD COLUMN updated_at TEXT;
ALTER TABLE documents           ADD COLUMN updated_at TEXT;
ALTER TABLE reminders           ADD COLUMN updated_at TEXT;
ALTER TABLE insurance_policies  ADD COLUMN updated_at TEXT;
ALTER TABLE holdings            ADD COLUMN updated_at TEXT;
ALTER TABLE access_grants       ADD COLUMN updated_at TEXT;
ALTER TABLE life_events         ADD COLUMN updated_at TEXT;
ALTER TABLE tax_income          ADD COLUMN updated_at TEXT;
ALTER TABLE tax_deductions      ADD COLUMN updated_at TEXT;
ALTER TABLE tax_payments        ADD COLUMN updated_at TEXT;
ALTER TABLE custom_options      ADD COLUMN updated_at TEXT;

UPDATE accounts           SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE goals              SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE vault_entries      SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE people             SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE documents          SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE reminders          SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE insurance_policies SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE holdings           SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE access_grants      SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE life_events        SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;
UPDATE tax_income         SET updated_at = datetime('now') WHERE updated_at IS NULL;
UPDATE tax_deductions     SET updated_at = datetime('now') WHERE updated_at IS NULL;
UPDATE tax_payments       SET updated_at = datetime('now') WHERE updated_at IS NULL;
UPDATE custom_options     SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL;

------------------------------------------------------------------------------
-- 3. AFTER INSERT triggers: fill sync_id / updated_at when the inserter didn't.
--    (Lets existing INSERT statements stay untouched.) The WHEN guard makes the
--    trigger a no-op for sync-applied inserts that already carry both values, so
--    the inner UPDATE never fires the touch trigger and the REMOTE updated_at is
--    preserved (correct regardless of the recursive_triggers pragma).
------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_accounts_ins AFTER INSERT ON accounts FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE accounts SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_goals_ins AFTER INSERT ON goals FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE goals SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_vault_entries_ins AFTER INSERT ON vault_entries FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE vault_entries SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_people_ins AFTER INSERT ON people FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE people SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_documents_ins AFTER INSERT ON documents FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE documents SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_reminders_ins AFTER INSERT ON reminders FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE reminders SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_insurance_policies_ins AFTER INSERT ON insurance_policies FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE insurance_policies SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_holdings_ins AFTER INSERT ON holdings FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE holdings SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_access_grants_ins AFTER INSERT ON access_grants FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE access_grants SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_life_events_ins AFTER INSERT ON life_events FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE life_events SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_income_ins AFTER INSERT ON tax_income FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE tax_income SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_deductions_ins AFTER INSERT ON tax_deductions FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE tax_deductions SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_payments_ins AFTER INSERT ON tax_payments FOR EACH ROW WHEN NEW.sync_id IS NULL OR NEW.updated_at IS NULL
BEGIN UPDATE tax_payments SET sync_id = COALESCE(NEW.sync_id, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_custom_options_ins AFTER INSERT ON custom_options FOR EACH ROW WHEN NEW.updated_at IS NULL
BEGIN UPDATE custom_options SET updated_at = COALESCE(NEW.updated_at, datetime('now')) WHERE rowid = NEW.rowid; END;

------------------------------------------------------------------------------
-- 4. AFTER UPDATE "touch" triggers: bump updated_at unless it was set explicitly.
------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_accounts_touch AFTER UPDATE ON accounts FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE accounts SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_goals_touch AFTER UPDATE ON goals FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE goals SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_vault_entries_touch AFTER UPDATE ON vault_entries FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE vault_entries SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_people_touch AFTER UPDATE ON people FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE people SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_documents_touch AFTER UPDATE ON documents FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE documents SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_reminders_touch AFTER UPDATE ON reminders FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE reminders SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_insurance_policies_touch AFTER UPDATE ON insurance_policies FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE insurance_policies SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_holdings_touch AFTER UPDATE ON holdings FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE holdings SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_access_grants_touch AFTER UPDATE ON access_grants FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE access_grants SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_life_events_touch AFTER UPDATE ON life_events FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE life_events SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_income_touch AFTER UPDATE ON tax_income FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE tax_income SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_deductions_touch AFTER UPDATE ON tax_deductions FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE tax_deductions SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_payments_touch AFTER UPDATE ON tax_payments FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE tax_payments SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_custom_options_touch AFTER UPDATE ON custom_options FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE custom_options SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_monthly_snapshot_touch AFTER UPDATE ON monthly_snapshot FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE monthly_snapshot SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_years_touch AFTER UPDATE ON tax_years FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE tax_years SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_assessment_touch AFTER UPDATE ON tax_assessment FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE tax_assessment SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_tax_wizard_answers_touch AFTER UPDATE ON tax_wizard_answers FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE tax_wizard_answers SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_health_profile_touch AFTER UPDATE ON health_profile FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE health_profile SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_will_meta_touch AFTER UPDATE ON will_meta FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE will_meta SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;
CREATE TRIGGER IF NOT EXISTS trg_incapacity_meta_touch AFTER UPDATE ON incapacity_meta FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE incapacity_meta SET updated_at = datetime('now') WHERE rowid = NEW.rowid; END;

------------------------------------------------------------------------------
-- 5. AFTER DELETE tombstone triggers. UUID tables key on sync_id; natural-key
--    tables key on their composite identity so the peer can match the row it
--    created independently.
------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_accounts_tomb AFTER DELETE ON accounts FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('accounts', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_goals_tomb AFTER DELETE ON goals FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('goals', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_vault_entries_tomb AFTER DELETE ON vault_entries FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('vault_entries', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_people_tomb AFTER DELETE ON people FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('people', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_documents_tomb AFTER DELETE ON documents FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('documents', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_reminders_tomb AFTER DELETE ON reminders FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('reminders', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_insurance_policies_tomb AFTER DELETE ON insurance_policies FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('insurance_policies', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_holdings_tomb AFTER DELETE ON holdings FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('holdings', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_access_grants_tomb AFTER DELETE ON access_grants FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('access_grants', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_life_events_tomb AFTER DELETE ON life_events FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('life_events', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_tax_income_tomb AFTER DELETE ON tax_income FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('tax_income', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_tax_deductions_tomb AFTER DELETE ON tax_deductions FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('tax_deductions', OLD.sync_id, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_tax_payments_tomb AFTER DELETE ON tax_payments FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('tax_payments', OLD.sync_id, datetime('now')); END;

-- Natural-key tombstones.
CREATE TRIGGER IF NOT EXISTS trg_monthly_snapshot_tomb AFTER DELETE ON monthly_snapshot FOR EACH ROW
BEGIN
  INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at)
  SELECT 'monthly_snapshot', a.sync_id || '|' || OLD.month, datetime('now')
  FROM accounts a WHERE a.id = OLD.account_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_custom_options_tomb AFTER DELETE ON custom_options FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at)
  VALUES('custom_options', OLD.category || '|' || COALESCE(OLD.parent, '') || '|' || OLD.value, datetime('now')); END;
CREATE TRIGGER IF NOT EXISTS trg_tax_years_tomb AFTER DELETE ON tax_years FOR EACH ROW
BEGIN INSERT OR REPLACE INTO sync_tombstones(table_name, key, deleted_at) VALUES('tax_years', OLD.ay, datetime('now')); END;
