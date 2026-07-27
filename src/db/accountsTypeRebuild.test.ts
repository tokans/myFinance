/**
 * Accounts-type CHECK-widening rebuild (3 new asset types for the Dashboard's
 * category breakdown — see accountsTypeRebuild.ts for why this runs outside the
 * generic aux-SQL framework). Fixtures build the pre-migration suite shape (the
 * narrower CHECK auxSql.ts's CANONICAL_TABLES v1 ships) via `ensureSuiteSchema`,
 * seed accounts + monthly_snapshot rows, then run the real `rebuildAccountsType`
 * engine — proving the CHECK is widened, every row/child FK survives untouched,
 * the sync triggers still work, and re-running is a safe no-op.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { SqlDb } from "sharedcorelib/db";
import { ensureSuiteSchema } from "./schemas";
import { rebuildAccountsType } from "./accountsTypeRebuild";
import { T } from "./tables";

function adapt(raw: DatabaseSync): SqlDb {
  const toParam = (v: unknown) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return v;
    if (v instanceof Uint8Array) return v;
    return JSON.stringify(v);
  };
  return {
    select: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      raw.prepare(sql).all(...params.map(toParam)) as R[],
    execute: async (sql: string, params: unknown[] = []) => {
      if (params.length === 0) { raw.exec(sql); return {}; }
      const r = raw.prepare(sql).run(...params.map(toParam));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
  };
}

async function preMigrationSuite(): Promise<{ raw: DatabaseSync; sql: SqlDb }> {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  const sql = adapt(raw);
  await ensureSuiteSchema(sql);
  return { raw, sql };
}

let raw: DatabaseSync;
let sql: SqlDb;

beforeEach(async () => { ({ raw, sql } = await preMigrationSuite()); });

describe("rebuildAccountsType", () => {
  it("sanity: the pre-migration CHECK rejects the new types", () => {
    expect(() => raw.exec(`INSERT INTO ${T.accounts} (id, name, type) VALUES (1, 'x', 'loan_given')`))
      .toThrow(/CHECK/i);
  });

  it("widens the CHECK so all 3 new types can be inserted afterward", async () => {
    const res = await rebuildAccountsType({ suite: sql });
    expect(res.status).toBe("rebuilt");
    for (const type of ["loan_given", "art_collectible", "vehicle"]) {
      expect(() => raw.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('${type} test', '${type}')`))
        .not.toThrow();
    }
  });

  it("preserves every existing account row (id, sync_id, values) and child snapshots", async () => {
    raw.exec(`
      INSERT INTO ${T.accounts} (id, name, type, currency, opening_balance, sync_id, updated_at)
        VALUES
          (1, 'HDFC Savings', 'bank_savings', 'INR', 1000, 'acc-1', '2024-01-01 09:00:00'),
          (2, 'Zerodha',      'stocks',       'INR', 0,    'acc-2', '2024-01-02 09:00:00');
      INSERT INTO ${T.monthlySnapshot} (id, account_id, month, value) VALUES (1, 1, '2026-01', 50000);
      INSERT INTO ${T.monthlySnapshot} (id, account_id, month, value) VALUES (2, 2, '2026-01', 120000);
    `);

    const res = await rebuildAccountsType({ suite: sql });
    expect(res.status).toBe("rebuilt");
    expect(res.rows).toBe(2);

    const accounts = await sql.select<{ id: number; name: string; sync_id: string }>(
      `SELECT id, name, sync_id FROM ${T.accounts} ORDER BY id`,
    );
    expect(accounts).toEqual([
      { id: 1, name: "HDFC Savings", sync_id: "acc-1" },
      { id: 2, name: "Zerodha", sync_id: "acc-2" },
    ]);

    // Child FK rows survived the DROP TABLE untouched (not cascade-deleted).
    const snaps = await sql.select<{ account_id: number; value: number }>(
      `SELECT account_id, value FROM ${T.monthlySnapshot} ORDER BY id`,
    );
    expect(snaps).toEqual([
      { account_id: 1, value: 50000 },
      { account_id: 2, value: 120000 },
    ]);

    // No dangling FK references post-rebuild.
    const violations = await sql.select("PRAGMA foreign_key_check");
    expect(violations).toEqual([]);
  });

  it("recreates the sync triggers (insert backfill still fires)", async () => {
    await rebuildAccountsType({ suite: sql });
    raw.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('New Account', 'cash')`);
    const [row] = await sql.select<{ sync_id: string | null; updated_at: string | null }>(
      `SELECT sync_id, updated_at FROM ${T.accounts} WHERE name = 'New Account'`,
    );
    expect(row?.sync_id).toBeTruthy();
    expect(row?.updated_at).toBeTruthy();
  });

  it("recreates the archived + unique sync indexes", async () => {
    await rebuildAccountsType({ suite: sql });
    const indexes = (raw.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ?`,
    ).all(T.accounts) as { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_mf_accounts_archived", "idx_mf_accounts_sync"]));
  });

  it("idempotent: a second run no-ops", async () => {
    await rebuildAccountsType({ suite: sql });
    const again = await rebuildAccountsType({ suite: sql });
    expect(again.status).toBe("already-done");
  });
});
