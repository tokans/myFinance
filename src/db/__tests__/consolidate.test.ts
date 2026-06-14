/**
 * One-time legacy→suite migrator (K1.2) + aux-SQL canonical tables (K1.1). The
 * legacy fixture is built from the REAL legacy migration SQL (src-tauri/migrations/
 * 0001..0023), the suite fixture from the real descriptors + aux steps — both on
 * actual SQLite (node:sqlite) — so the copy/verify/ledger/delete semantics are
 * exercised end-to-end, including integer-rowid + FK + trigger interplay.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  consolidateLegacyDb, checksumRows, LEGACY_TABLES, CHECKSUM_SAMPLE_LIMIT,
  type ConsolidateDeps,
} from "../consolidate";
import { ensureSuiteSchema } from "../schemas";
import { T } from "../tables";
import { openSqliteTestDb, type SqliteTestDb } from "./sqliteTestDb";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "src-tauri", "migrations");
const MIGRATION_FILES = [
  "0001_init", "0002_tax", "0003_goal_category", "0004_account_types",
  "0005_account_type_pms_aif", "0006_account_maturity_date", "0007_custom_options",
  "0008_account_emergency", "0009_people_documents", "0010_reminders",
  "0011_health_profile", "0012_insurance", "0013_holdings", "0014_will_meta",
  "0015_incapacity", "0016_access_audit", "0017_life_events", "0018_app_launches",
  "0019_master_options", "0020_partners", "0021_sync", "0022_account_type_tax_refund",
  "0023_account_sip",
];

/** Build the legacy myfinance.db from the real migration files, in order. */
function applyLegacyMigrations(fix: SqliteTestDb): void {
  // FK off during schema build (0022 rebuilds accounts); the app plugin does the same.
  fix.raw.exec("PRAGMA foreign_keys = OFF;");
  for (const f of MIGRATION_FILES) {
    fix.raw.exec(readFileSync(join(MIGRATIONS_DIR, `${f}.sql`), "utf8"));
  }
  fix.raw.exec("PRAGMA foreign_keys = ON;");
}

/** Seed representative data with cross-table integer-FK relationships + edge cases. */
function seedLegacy(fix: SqliteTestDb): void {
  fix.raw.exec(`
    INSERT INTO vault_entries (id, label, stronghold_key, created_at, sync_id, updated_at)
      VALUES (1, 'Bank login', 'sh-key-1', '2024-01-01 09:00:00', 'v-sync-1', '2024-01-01 09:00:00');
    INSERT INTO accounts (id, name, type, institution, currency, opening_balance, credential_id, created_at, contact, sync_id, updated_at)
      VALUES (1, 'Savings ☕', 'bank_savings', 'HDFC', 'INR', 1000, 1, '2024-01-01 09:00:00', 'Spouse +91-99', 'a-sync-1', '2024-01-02 09:00:00'),
             (2, 'MF SIP', 'mutual_funds', 'Zerodha', 'INR', 0, NULL, '2024-01-01 09:00:00', NULL, 'a-sync-2', '2024-01-02 09:00:00');
    INSERT INTO monthly_snapshot (id, account_id, month, value, source, updated_at)
      VALUES (1, 1, '2024-01', 1500, 'manual', '2024-02-01 09:00:00'),
             (2, 1, '2024-02', 1750, 'import', '2024-03-01 09:00:00');
    INSERT INTO goals (id, name, target_amount, category, sync_id, updated_at)
      VALUES (1, 'Emergency fund', 500000, 'safety', 'g-sync-1', '2024-01-02 09:00:00');
    INSERT INTO people (id, name, relationship, phone, access_tier, sync_id, updated_at)
      VALUES (1, 'Asha', 'spouse', '+91-99', 2, 'p-sync-1', '2024-01-02 09:00:00');
    INSERT INTO documents (id, type, title, person_id, account_id, encrypted, sync_id, updated_at)
      VALUES (1, 'will', 'My Will', 1, 1, 1, 'd-sync-1', '2024-01-02 09:00:00');
    INSERT INTO holdings (id, account_id, person_id, role, share_pct, sync_id, updated_at)
      VALUES (1, 1, 1, 'nominee', 100, 'h-sync-1', '2024-01-02 09:00:00');
    INSERT INTO will_meta (id, has_will, executor_person_id, updated_at)
      VALUES (1, 1, 1, '2024-01-02 09:00:00');
    INSERT INTO tax_years (ay, itr_form, created_at, updated_at)
      VALUES ('AY2026-27', '2', '2024-01-01 09:00:00', '2024-01-01 09:00:00');
    INSERT INTO tax_income (id, ay, head, label, amount, sync_id, updated_at)
      VALUES (1, 'AY2026-27', 'salary', 'Base', 1200000, 'ti-sync-1', '2024-01-02 09:00:00');
    INSERT INTO custom_options (id, category, value, label, created_at, updated_at)
      VALUES (1, 'institution', 'mybank', 'My Bank', '2024-01-01 09:00:00', '2024-01-01 09:00:00');
    INSERT INTO app_launches (id, launched_at) VALUES (1, '2024-01-01 09:00:00');
    INSERT INTO master_options (id, master_id, value, label, version, updated_at)
      VALUES (1, 'country', 'IN', 'India', 3, '2024-01-01 09:00:00');
    INSERT INTO partners (id, professional_type, name, version, updated_at)
      VALUES (1, 'Doctor', 'Dr X', 1, '2024-01-01 09:00:00');
  `);
}

interface Harness {
  legacy: SqliteTestDb;
  suite: SqliteTestDb;
  legacyFileExists: boolean;
  deps: ConsolidateDeps;
  removeLegacy: ReturnType<typeof vi.fn>;
  logs: string[];
}

async function makeHarness(opts: { withLegacy?: boolean } = {}): Promise<Harness> {
  const legacy = openSqliteTestDb();
  const suite = openSqliteTestDb();
  opened = true;
  await ensureSuiteSchema(suite.db);
  const withLegacy = opts.withLegacy ?? true;
  if (withLegacy) { applyLegacyMigrations(legacy); seedLegacy(legacy); }

  const logs: string[] = [];
  const h: Harness = {
    legacy, suite, legacyFileExists: withLegacy,
    removeLegacy: vi.fn(async () => {
      const had = h.legacyFileExists;
      h.legacyFileExists = false;
      return had;
    }),
    logs,
    deps: undefined as unknown as ConsolidateDeps,
  };
  h.deps = {
    suite: suite.db,
    legacyExists: async () => h.legacyFileExists,
    openLegacy: async () => legacy.db,
    removeLegacy: h.removeLegacy as unknown as () => Promise<boolean>,
    log: (m) => logs.push(m),
    now: () => new Date("2026-06-12T00:00:00Z"),
  };
  return h;
}

let h: Harness;
let opened = false;
afterEach(() => {
  if (opened) { h.legacy.close(); h.suite.close(); opened = false; }
});

describe("ensureSuiteSchema (canonical aux-SQL tables)", () => {
  it("builds INTEGER-keyed tables with CHECKs + sync triggers", async () => {
    const fix = openSqliteTestDb();
    try {
      await ensureSuiteSchema(fix.db);
      await ensureSuiteSchema(fix.db); // idempotent

      // INTEGER PRIMARY KEY AUTOINCREMENT: an insert without id gets a numeric rowid.
      await fix.db.execute(
        `INSERT INTO ${T.accounts} (name, type) VALUES ('x', 'cash')`,
      );
      const [acc] = await fix.db.select<{ id: number; sync_id: string; updated_at: string }>(
        `SELECT id, sync_id, updated_at FROM ${T.accounts}`,
      );
      expect(typeof acc!.id).toBe("number"); // integer rowid, not "1" text
      // The aux AFTER INSERT trigger backfilled sync_id + updated_at.
      expect(acc!.sync_id).toBeTruthy();
      expect(acc!.updated_at).toBeTruthy();

      // CHECK constraint on accounts.type rejects an unknown type.
      await expect(
        fix.db.execute(`INSERT INTO ${T.accounts} (name, type) VALUES ('y', 'not_a_type')`),
      ).rejects.toThrow();

      // DELETE writes a namespaced tombstone keyed on the LEGACY logical name.
      await fix.db.execute(`DELETE FROM ${T.accounts} WHERE name = 'x'`);
      const tombs = await fix.db.select<{ table_name: string; key: string }>(
        `SELECT table_name, key FROM ${T.syncTombstones}`,
      );
      expect(tombs.some((t) => t.table_name === "accounts")).toBe(true);

      // Settings seed row present.
      const [s] = await fix.db.select<{ value: string }>(
        `SELECT value FROM ${T.settings} WHERE key = 'currency'`,
      );
      expect(s!.value).toBe("INR");
    } finally {
      fix.close();
    }
  });
});

describe("consolidateLegacyDb", () => {
  it("copies every present table verbatim (integer keys + FKs + timestamps preserved), verifies, ledgers, deletes", async () => {
    h = await makeHarness();
    const r = await consolidateLegacyDb(h.deps);

    expect(r.status).toBe("migrated");
    expect(r.legacyDeleted).toBe(true);
    expect(h.removeLegacy).toHaveBeenCalledTimes(1);

    // Content equality, table by table (full rows incl. unicode/NULLs/integer ids).
    for (const spec of LEGACY_TABLES) {
      const order = spec.keyColumns.join(", ");
      const before = await h.legacy.db.select(`SELECT * FROM ${spec.legacy} ORDER BY ${order}`);
      const after = await h.suite.db.select(`SELECT * FROM ${spec.suite} ORDER BY ${order}`);
      expect(after, spec.legacy).toEqual(before);
    }

    // Integer FK fidelity: the copied document still joins to its account/person by id.
    const [doc] = await h.suite.db.select<{ id: number; account_id: number; person_id: number }>(
      `SELECT id, account_id, person_id FROM ${T.documents}`,
    );
    expect(doc!.account_id).toBe(1);
    expect(doc!.person_id).toBe(1);
    const [joined] = await h.suite.db.select<{ acc: string; who: string }>(
      `SELECT a.name AS acc, p.name AS who
         FROM ${T.documents} d
         JOIN ${T.accounts} a ON a.id = d.account_id
         JOIN ${T.people} p ON p.id = d.person_id`,
    );
    expect(joined!.acc).toBe("Savings ☕");
    expect(joined!.who).toBe("Asha");

    // Timestamps copied verbatim — the aux backfill trigger must not rewrite them.
    const [acc1] = await h.suite.db.select<{ updated_at: string }>(
      `SELECT updated_at FROM ${T.accounts} WHERE id = 1`,
    );
    expect(acc1!.updated_at).toBe("2024-01-02 09:00:00");

    // Ledger: a done marker + a row per copied table with evidence.
    const ledger = await h.suite.db.select<{ entry_id: string; status: string; checksum: string | null }>(
      `SELECT entry_id, status, checksum FROM ${T.migrationLedger} WHERE entry_id = 'migration' OR entry_id = 'table:accounts'`,
    );
    expect(ledger.find((l) => l.entry_id === "migration")!.status).toBe("done");
    expect(ledger.find((l) => l.entry_id === "table:accounts")!.checksum).toMatch(/^fnv1a:/);
  });

  it("is idempotent — a second run no-ops and never touches the (gone) legacy file", async () => {
    h = await makeHarness();
    await consolidateLegacyDb(h.deps);
    h.removeLegacy.mockClear();

    const r2 = await consolidateLegacyDb(h.deps);
    expect(r2.status).toBe("already-done");
    expect(h.removeLegacy).not.toHaveBeenCalled();
    expect(await h.suite.db.select(`SELECT COUNT(*) AS n FROM ${T.accounts}`)).toEqual([{ n: 2 }]);
  });

  it("finishes a pending file deletion when a crash hit between done-mark and delete", async () => {
    h = await makeHarness();
    const failingDeps = { ...h.deps, removeLegacy: async () => { throw new Error("locked"); } };
    await expect(consolidateLegacyDb(failingDeps)).rejects.toThrow("locked");
    expect(h.legacyFileExists).toBe(true);

    const r = await consolidateLegacyDb(h.deps);
    expect(r.status).toBe("already-done");
    expect(r.legacyDeleted).toBe(true);
    expect(h.removeLegacy).toHaveBeenCalledTimes(1);
  });

  it("resumes after a mid-migration crash: completed tables skip, partial tables re-copy", async () => {
    h = await makeHarness();
    let calls = 0;
    const crashingSuite: typeof h.suite.db = {
      select: h.suite.db.select,
      execute: async (sql, params) => {
        if (sql.includes(T.monthlySnapshot) && sql.startsWith("INSERT") && ++calls === 2) {
          throw new Error("simulated crash");
        }
        return h.suite.db.execute(sql, params);
      },
    };
    await expect(consolidateLegacyDb({ ...h.deps, suite: crashingSuite })).rejects.toThrow("simulated crash");
    expect(h.removeLegacy).not.toHaveBeenCalled();
    // Partial: one snapshot copied, no ledger row for it yet.
    expect(await h.suite.db.select(`SELECT COUNT(*) AS n FROM ${T.monthlySnapshot}`)).toEqual([{ n: 1 }]);

    const r = await consolidateLegacyDb(h.deps);
    expect(r.status).toBe("migrated");
    expect(r.legacyDeleted).toBe(true);
    expect(r.tables.find((t) => t.table === "monthly_snapshot")!.skipped).toBe(false);
    expect(r.tables.find((t) => t.table === "accounts")!.skipped).toBe(true);
    expect(await h.suite.db.select(`SELECT COUNT(*) AS n FROM ${T.monthlySnapshot}`)).toEqual([{ n: 2 }]);
  });

  it("a row-count verification failure aborts WITHOUT deleting the legacy DB", async () => {
    h = await makeHarness();
    const lossySuite: typeof h.suite.db = {
      select: h.suite.db.select,
      execute: async (sql, params) => {
        if (sql.startsWith("INSERT") && sql.includes(T.partners)) return {};
        return h.suite.db.execute(sql, params);
      },
    };
    await expect(consolidateLegacyDb({ ...h.deps, suite: lossySuite })).rejects.toThrow(/verify failed for partners/);
    expect(h.removeLegacy).not.toHaveBeenCalled();
    expect(await h.suite.db.select(`SELECT * FROM ${T.migrationLedger} WHERE entry_id = 'migration'`)).toEqual([]);
  });

  it("fresh install (no legacy file): records 'no-legacy' and never opens/deletes anything", async () => {
    h = await makeHarness({ withLegacy: false });
    const openLegacy = vi.fn(h.deps.openLegacy);
    const r = await consolidateLegacyDb({ ...h.deps, openLegacy });

    expect(r.status).toBe("no-legacy");
    expect(openLegacy).not.toHaveBeenCalled();
    expect(h.removeLegacy).not.toHaveBeenCalled();
    expect((await consolidateLegacyDb(h.deps)).status).toBe("already-done");
  });
});

describe("checksumRows", () => {
  it("is order- and content-sensitive but column-order-insensitive", () => {
    const a = checksumRows([{ x: 1, y: "a" }, { x: 2, y: "b" }]);
    expect(checksumRows([{ y: "a", x: 1 }, { y: "b", x: 2 }])).toBe(a);
    expect(checksumRows([{ x: 2, y: "b" }, { x: 1, y: "a" }])).not.toBe(a);
    expect(checksumRows([{ x: 1, y: "a" }, { x: 2, y: "c" }])).not.toBe(a);
    expect(CHECKSUM_SAMPLE_LIMIT).toBeGreaterThan(0);
  });
});
