import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildMergeSql, type AccountKind } from "./accounts";
import { T } from "./tables";

// Spin up a real in-memory SQLite mirroring the merge-relevant schema. We run
// the merge by executing buildMergeSql() via `db.exec`, which — like the Tauri
// plugin's single `pool.execute` — runs the whole BEGIN…COMMIT batch on one
// connection. Reads in the assertions go straight to the raw db.
function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE ${T.vaultEntries} (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      label           TEXT NOT NULL,
      stronghold_key  TEXT NOT NULL UNIQUE
    );
    CREATE TABLE ${T.accounts} (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL DEFAULT 'other',
      currency        TEXT NOT NULL DEFAULT 'INR',
      opening_balance REAL NOT NULL DEFAULT 0,
      credential_id   INTEGER REFERENCES ${T.vaultEntries}(id) ON DELETE SET NULL,
      is_archived     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE ${T.monthlySnapshot} (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER NOT NULL REFERENCES ${T.accounts}(id) ON DELETE CASCADE,
      month       TEXT NOT NULL,
      value       REAL NOT NULL,
      UNIQUE (account_id, month)
    );
    CREATE TABLE ${T.reminders} (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      due_date    TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'manual',
      dedupe_key  TEXT UNIQUE,
      account_id  INTEGER REFERENCES ${T.accounts}(id) ON DELETE CASCADE
    );
  `);

  // Mirror mergeAccounts(): build the script and run it as one batch.
  const merge = (
    survivorId: number,
    mergeIds: number[],
    kinds?: Map<number, AccountKind>,
  ) => {
    const sql = buildMergeSql(survivorId, mergeIds, kinds);
    if (sql) db.exec(sql);
  };

  const all = <T>(sql: string, params: unknown[] = []): T[] =>
    db.prepare(sql).all(...(params as never[])) as T[];

  return { db, merge, all };
}

interface SnapRow { account_id: number; month: string; value: number }

describe("merge accounts", () => {
  let ctx: ReturnType<typeof makeDb>;

  beforeEach(() => {
    ctx = makeDb();
    // Three accounts. We'll merge #2 and #3 into survivor #1.
    ctx.db.exec(`
      INSERT INTO ${T.accounts} (id, name) VALUES (1, 'HDFC'), (2, 'HDFC Bank'), (3, 'hdfc dup');
      INSERT INTO ${T.monthlySnapshot} (account_id, month, value) VALUES
        (1, '2026-01', 100),   -- survivor only
        (1, '2026-03', 300),   -- overlaps with acct 2 -> survivor wins
        (2, '2026-02', 222),   -- moves to survivor
        (2, '2026-03', 999),   -- conflict, dropped
        (3, '2026-04', 444);   -- moves to survivor
    `);
  });

  it("moves non-overlapping snapshots onto the survivor and keeps the survivor's value on conflicts", () => {
    ctx.merge(1, [1, 2, 3]);

    const snaps = ctx
      .all<SnapRow>(`SELECT account_id, month, value FROM ${T.monthlySnapshot} ORDER BY month`);
    // Everything now belongs to the survivor.
    expect(snaps.every((s) => s.account_id === 1)).toBe(true);
    const byMonth = Object.fromEntries(snaps.map((s) => [s.month, s.value]));
    expect(byMonth).toEqual({
      "2026-01": 100,
      "2026-02": 222,
      "2026-03": 300, // survivor's value won, not 999
      "2026-04": 444,
    });
  });

  it("deletes the merged-away accounts and leaves the survivor", () => {
    ctx.merge(1, [1, 2, 3]);
    const ids = ctx.all<{ id: number }>(`SELECT id FROM ${T.accounts} ORDER BY id`).map((r) => r.id);
    expect(ids).toEqual([1]);
  });

  it("runs the whole batch atomically without throwing (no spurious transaction error)", () => {
    expect(() => ctx.merge(1, [1, 2, 3])).not.toThrow();
    // No transaction left dangling: a follow-up write succeeds immediately.
    expect(() => ctx.db.exec(`INSERT INTO ${T.accounts} (id, name) VALUES (9, 'after')`)).not.toThrow();
  });

  it("is a no-op when only the survivor is selected", () => {
    expect(buildMergeSql(1, [1])).toBeNull();
    ctx.merge(1, [1]);
    const ids = ctx.all<{ id: number }>(`SELECT id FROM ${T.accounts} ORDER BY id`).map((r) => r.id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it("tolerates the survivor not being listed in mergeIds", () => {
    ctx.merge(1, [2, 3]);
    const ids = ctx.all<{ id: number }>(`SELECT id FROM ${T.accounts} ORDER BY id`).map((r) => r.id);
    expect(ids).toEqual([1]);
    const moved = ctx.all<SnapRow>(`SELECT month FROM ${T.monthlySnapshot} WHERE account_id = 1`);
    expect(moved.map((s) => s.month).sort()).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("does not clash when two merged-away accounts share a month the survivor lacks", () => {
    // Both #2 and #3 have 2026-05, which the survivor #1 does not. The first to
    // run claims it; the second must skip it instead of hitting the UNIQUE constraint.
    ctx.db.exec(`
      INSERT INTO ${T.monthlySnapshot} (account_id, month, value) VALUES
        (2, '2026-05', 500),
        (3, '2026-05', 555);
    `);
    expect(() => ctx.merge(1, [1, 2, 3])).not.toThrow();
    const may = ctx.all<SnapRow>(
      `SELECT account_id, value FROM ${T.monthlySnapshot} WHERE month = '2026-05'`,
    );
    expect(may).toHaveLength(1);
    expect(may[0].account_id).toBe(1);
    expect(may[0].value).toBe(500); // account #2 won (listed first)
  });

  it("removes merged-away credential pointers but keeps the survivor's", () => {
    ctx.db.exec(`
      INSERT INTO ${T.vaultEntries} (id, label, stronghold_key) VALUES
        (10, 'survivor cred', 'k-surv'),
        (20, 'doomed cred',  'k-doom');
      UPDATE ${T.accounts} SET credential_id = 10 WHERE id = 1;
      UPDATE ${T.accounts} SET credential_id = 20 WHERE id = 2;
    `);

    ctx.merge(1, [1, 2, 3]);

    const vaultIds = ctx.all<{ id: number }>(`SELECT id FROM ${T.vaultEntries} ORDER BY id`).map((r) => r.id);
    expect(vaultIds).toEqual([10]); // doomed (20) gone, survivor (10) kept
    const survivorCred = ctx.all<{ credential_id: number | null }>(
      `SELECT credential_id FROM ${T.accounts} WHERE id = 1`,
    )[0];
    expect(survivorCred.credential_id).toBe(10);
  });

  it("removes reminders linked to merged-away accounts but keeps the survivor's", () => {
    ctx.db.exec(`
      INSERT INTO ${T.reminders} (title, due_date, source, dedupe_key, account_id) VALUES
        ('survivor manual', '2026-01-01', 'manual', NULL,    1),
        ('doomed manual',   '2026-02-01', 'manual', NULL,    2),
        ('doomed derived',  '2026-03-01', 'derived', 'fd:3', 3);
    `);

    ctx.merge(1, [1, 2, 3]);

    const rem = ctx.all<{ account_id: number }>(
      `SELECT account_id FROM ${T.reminders} ORDER BY account_id`,
    );
    expect(rem).toEqual([{ account_id: 1 }]); // only the survivor's reminder remains
  });

  it("wraps the script in a single BEGIN/COMMIT transaction", () => {
    const sql = buildMergeSql(1, [2, 3])!;
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    // One move statement per doomed account.
    expect(sql.match(new RegExp(`UPDATE ${T.monthlySnapshot}`, "g"))).toHaveLength(2);
  });

  it("rejects non-integer ids rather than inlining them", () => {
    expect(() => buildMergeSql(1, [2, 3.5])).toThrow(/Invalid account id/);
    expect(() => buildMergeSql(1.2, [2])).toThrow(/Invalid account id/);
  });

  it("negates a liability's moved values when merged into an asset survivor", () => {
    // Survivor #1 is an asset; #2 is a liability, #3 an asset.
    const kinds = new Map<number, AccountKind>([
      [1, "asset"],
      [2, "liability"],
      [3, "asset"],
    ]);
    ctx.merge(1, [1, 2, 3], kinds);

    const snaps = ctx.all<SnapRow>(
      `SELECT account_id, month, value FROM ${T.monthlySnapshot} ORDER BY month`,
    );
    expect(snaps.every((s) => s.account_id === 1)).toBe(true);
    const byMonth = Object.fromEntries(snaps.map((s) => [s.month, s.value]));
    expect(byMonth).toEqual({
      "2026-01": 100, // survivor's own asset value, untouched
      "2026-02": -222, // liability #2 folded in -> negated
      "2026-03": 300, // conflict, survivor wins (doomed 999 dropped)
      "2026-04": 444, // asset #3, same kind as survivor -> unchanged
    });
  });

  it("negates an asset's moved values when merged into a liability survivor", () => {
    // Symmetric case: survivor #1 is a liability, the folded-in assets flip.
    const kinds = new Map<number, AccountKind>([
      [1, "liability"],
      [2, "asset"],
      [3, "asset"],
    ]);
    ctx.merge(1, [1, 2, 3], kinds);

    const byMonth = Object.fromEntries(
      ctx
        .all<SnapRow>(`SELECT month, value FROM ${T.monthlySnapshot}`)
        .map((s) => [s.month, s.value]),
    );
    expect(byMonth).toEqual({
      "2026-01": 100, // survivor's own liability value, untouched
      "2026-02": -222, // asset #2 folded into a liability -> negated
      "2026-03": 300,
      "2026-04": -444, // asset #3 folded in -> negated
    });
  });

  it("leaves values untouched when all merged accounts share a kind", () => {
    const kinds = new Map<number, AccountKind>([
      [1, "asset"],
      [2, "asset"],
      [3, "asset"],
    ]);
    ctx.merge(1, [1, 2, 3], kinds);
    const v = ctx.all<SnapRow>(
      `SELECT value FROM ${T.monthlySnapshot} WHERE month = '2026-02'`,
    );
    expect(v[0].value).toBe(222);
  });

  it("only flips the cross-kind account in the generated SQL", () => {
    const kinds = new Map<number, AccountKind>([
      [1, "asset"],
      [2, "liability"],
      [3, "asset"],
    ]);
    const sql = buildMergeSql(1, [2, 3], kinds)!;
    // Exactly one move statement negates (the liability #2); #3 stays plain.
    expect(sql.match(/value = -ABS\(value\)/g)).toHaveLength(1);
  });

  it("does not flip when kinds are omitted (back-compat)", () => {
    const sql = buildMergeSql(1, [2, 3])!;
    expect(sql).not.toMatch(/-ABS\(value\)/);
  });
});
