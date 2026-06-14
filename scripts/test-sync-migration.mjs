// Dry-run: replay every migration 0001..0021 into an in-memory SQLite and
// exercise the sync triggers. Run: node --experimental-sqlite scripts/test-sync-migration.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, "..", "src-tauri", "migrations");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");

const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const sql = readFileSync(join(migDir, f), "utf8");
  try {
    db.exec(sql);
  } catch (e) {
    console.error(`❌ migration ${f} failed:\n   ${e.message}`);
    process.exit(1);
  }
}
console.log(`✅ applied ${files.length} migrations`);

// 1. New rows auto-get a sync_id + updated_at via the AFTER INSERT trigger.
db.exec(`INSERT INTO accounts (name, type) VALUES ('Test Bank', 'bank_savings')`);
const acc = db.prepare("SELECT id, sync_id, updated_at FROM accounts").get();
if (!acc.sync_id || acc.sync_id.length !== 32) throw new Error(`sync_id not auto-set: ${JSON.stringify(acc)}`);
if (!acc.updated_at) throw new Error(`updated_at not auto-set: ${JSON.stringify(acc)}`);
console.log(`✅ insert auto-fills sync_id=${acc.sync_id.slice(0, 8)}… updated_at=${acc.updated_at}`);

// 2. A normal UPDATE that doesn't touch updated_at gets it bumped by the touch trigger.
const before = acc.updated_at;
// force a different clock second so the bump is observable
db.exec("UPDATE accounts SET updated_at = '2000-01-01 00:00:00' WHERE id = " + acc.id); // explicit set => no bump
const afterExplicit = db.prepare("SELECT updated_at FROM accounts WHERE id = ?").get(acc.id).updated_at;
if (afterExplicit !== "2000-01-01 00:00:00") throw new Error(`explicit updated_at was clobbered: ${afterExplicit}`);
db.exec("UPDATE accounts SET name = 'Renamed' WHERE id = " + acc.id); // no updated_at => bump
const afterEdit = db.prepare("SELECT updated_at FROM accounts WHERE id = ?").get(acc.id).updated_at;
if (afterEdit === "2000-01-01 00:00:00") throw new Error("touch trigger did not bump updated_at on a normal edit");
console.log(`✅ touch trigger: explicit set preserved (${afterExplicit}); normal edit bumped to ${afterEdit}`);

// 3. Deleting a row writes a tombstone keyed by sync_id.
db.exec("DELETE FROM accounts WHERE id = " + acc.id);
const tomb = db.prepare("SELECT table_name, key FROM sync_tombstones WHERE table_name='accounts'").get();
if (!tomb || tomb.key !== acc.sync_id) throw new Error(`tombstone not written correctly: ${JSON.stringify(tomb)}`);
console.log(`✅ delete wrote tombstone key=${tomb.key.slice(0, 8)}…`);

// 4. Natural-key snapshot tombstone composes account.sync_id|month.
db.exec(`INSERT INTO accounts (name, type) VALUES ('B', 'bank_savings')`);
const a2 = db.prepare("SELECT id, sync_id FROM accounts WHERE name='B'").get();
db.exec(`INSERT INTO monthly_snapshot (account_id, month, value) VALUES (${a2.id}, '2026-01', 100)`);
db.exec(`DELETE FROM monthly_snapshot WHERE account_id = ${a2.id} AND month='2026-01'`);
const snapTomb = db.prepare("SELECT key FROM sync_tombstones WHERE table_name='monthly_snapshot'").get();
if (snapTomb.key !== `${a2.sync_id}|2026-01`) throw new Error(`snapshot tombstone key wrong: ${snapTomb.key}`);
console.log(`✅ snapshot tombstone key=${snapTomb.key.slice(0, 12)}…`);

// 5. device_id seeded into settings.
const dev = db.prepare("SELECT value FROM settings WHERE key='device_id'").get();
if (!dev || dev.value.length !== 32) throw new Error(`device_id not seeded: ${JSON.stringify(dev)}`);
console.log(`✅ device_id seeded=${dev.value.slice(0, 8)}…`);

// 6. A sync-style insert (explicit sync_id + updated_at) must preserve BOTH —
//    the guarded insert trigger must not bump updated_at to "now".
db.exec("PRAGMA recursive_triggers = ON"); // worst case for the touch-trigger cascade
db.exec(`INSERT INTO accounts (name, type, sync_id, updated_at)
         VALUES ('Remote', 'bank_savings', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2025-03-04 05:06:07')`);
const remote = db.prepare("SELECT sync_id, updated_at FROM accounts WHERE name='Remote'").get();
if (remote.sync_id !== "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") throw new Error(`remote sync_id not preserved: ${remote.sync_id}`);
if (remote.updated_at !== "2025-03-04 05:06:07") throw new Error(`remote updated_at clobbered: ${remote.updated_at}`);
console.log(`✅ sync insert preserves remote sync_id + updated_at (${remote.updated_at})`);

console.log("\nALL CHECKS PASSED");
