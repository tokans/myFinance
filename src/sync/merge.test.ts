import { describe, it, expect, beforeEach } from "vitest";
import { buildBundle } from "./bundle";
import { applyBundle, type SyncDb } from "./merge";
import type { SyncCredential } from "./spec";
import { T } from "@/db/tables";
import { buildSuiteTestDb } from "@/db/__tests__/suiteTestDb";

/**
 * A fresh suite DB (namespaced myfinance_* tables built from the real descriptors +
 * aux-SQL, the same path production uses) plus a SyncDb adapter and a device id.
 */
async function makeDevice(deviceId: string) {
  const db = await buildSuiteTestDb();
  db.exec(`UPDATE ${T.settings} SET value = '${deviceId}' WHERE key = 'device_id'`);

  const adapter: SyncDb = {
    async select(sql, params = []) {
      return db.prepare(sql).all(...(params as never[])) as never;
    },
    async execute(sql, params = []) {
      const r = db.prepare(sql).run(...(params as never[]));
      return { lastInsertId: Number(r.lastInsertRowid), rowsAffected: Number(r.changes) };
    },
  };
  const all = <R>(sql: string, params: unknown[] = []): R[] =>
    db.prepare(sql).all(...(params as never[])) as R[];
  return { db, deviceId, sync: adapter, all };
}

type Dev = Awaited<ReturnType<typeof makeDevice>>;

async function syncOneWay(from: Dev, to: Dev, at: string, opts: Parameters<typeof applyBundle>[2] extends infer O ? Partial<O> : never = {}) {
  const bundle = await buildBundle(from.sync, { deviceId: from.deviceId, createdAt: at, ...(opts as object) });
  return applyBundle(to.sync, bundle, { localDeviceId: to.deviceId, ...(opts as object) });
}

const A_ID = "11111111111111111111111111111111";
const B_ID = "22222222222222222222222222222222"; // lexicographically greater → wins ties

describe("device sync merge", () => {
  let A: Dev;
  let B: Dev;
  beforeEach(async () => {
    A = await makeDevice(A_ID);
    B = await makeDevice(B_ID);
  });

  it("propagates a new account + snapshot and remaps the FK to the peer's local id", async () => {
    // B already has its own account so autoincrement ids differ from A's.
    B.db.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('B-only', 'cash')`);
    A.db.exec(`INSERT INTO ${T.accounts} (name, type, currency) VALUES ('HDFC', 'bank_savings', 'INR')`);
    const aAcc = A.all<{ id: number; sync_id: string }>(`SELECT id, sync_id FROM ${T.accounts}`)[0];
    A.db.exec(`INSERT INTO ${T.monthlySnapshot} (account_id, month, value) VALUES (${aAcc.id}, '2026-01', 500)`);

    await syncOneWay(A, B, "2026-02-01 10:00:00");

    const bAcc = B.all<{ id: number; sync_id: string }>(`SELECT id, sync_id FROM ${T.accounts} WHERE name='HDFC'`)[0];
    expect(bAcc.sync_id).toBe(aAcc.sync_id); // identity preserved
    expect(bAcc.id).not.toBe(aAcc.id); // but a different local id
    const snap = B.all<{ account_id: number; value: number }>(
      `SELECT account_id, value FROM ${T.monthlySnapshot} WHERE month='2026-01'`,
    )[0];
    expect(snap.value).toBe(500);
    expect(snap.account_id).toBe(bAcc.id); // FK remapped to B's local id
  });

  it("resolves a conflicting edit by last-writer-wins and converges both devices", async () => {
    A.db.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('Orig', 'bank_savings')`);
    await syncOneWay(A, B, "2026-02-01 10:00:00"); // B now has the row with A's sync_id

    // Both edit the name; B edits LATER, so B should win on both devices.
    A.db.exec(`UPDATE ${T.accounts} SET name='A-edit', updated_at='2026-03-01 09:00:00' WHERE name='Orig'`);
    B.db.exec(`UPDATE ${T.accounts} SET name='B-edit', updated_at='2026-03-01 12:00:00' WHERE name='Orig'`);

    await syncOneWay(A, B, "2026-03-02 00:00:00"); // A→B: A older, B keeps B-edit
    await syncOneWay(B, A, "2026-03-02 00:00:00"); // B→A: B newer, A takes B-edit

    expect(A.all<{ name: string }>(`SELECT name FROM ${T.accounts}`)[0].name).toBe("B-edit");
    expect(B.all<{ name: string }>(`SELECT name FROM ${T.accounts}`)[0].name).toBe("B-edit");
  });

  it("breaks an exact timestamp tie deterministically by higher device id", async () => {
    A.db.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('Orig', 'bank_savings')`);
    await syncOneWay(A, B, "2026-02-01 10:00:00");
    const ts = "2026-03-01 12:00:00";
    A.db.exec(`UPDATE ${T.accounts} SET name='A-edit', updated_at='${ts}' WHERE name='Orig'`);
    B.db.exec(`UPDATE ${T.accounts} SET name='B-edit', updated_at='${ts}' WHERE name='Orig'`);

    await syncOneWay(A, B, ts);
    await syncOneWay(B, A, ts);

    // B_ID > A_ID, so B-edit wins on both.
    expect(A.all<{ name: string }>(`SELECT name FROM ${T.accounts}`)[0].name).toBe("B-edit");
    expect(B.all<{ name: string }>(`SELECT name FROM ${T.accounts}`)[0].name).toBe("B-edit");
  });

  it("merges an independently-created snapshot for the same (account, month) by natural key", async () => {
    A.db.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('Shared', 'bank_savings')`);
    await syncOneWay(A, B, "2026-02-01 10:00:00"); // share the account

    // Each device sets a different value for the same month.
    const aAcc = A.all<{ id: number }>(`SELECT id FROM ${T.accounts}`)[0].id;
    const bAcc = B.all<{ id: number }>(`SELECT id FROM ${T.accounts}`)[0].id;
    A.db.exec(`INSERT INTO ${T.monthlySnapshot} (account_id, month, value, updated_at) VALUES (${aAcc}, '2026-01', 100, '2026-03-01 09:00:00')`);
    B.db.exec(`INSERT INTO ${T.monthlySnapshot} (account_id, month, value, updated_at) VALUES (${bAcc}, '2026-01', 200, '2026-03-01 12:00:00')`);

    await syncOneWay(A, B, "2026-03-02 00:00:00");
    await syncOneWay(B, A, "2026-03-02 00:00:00");

    // Newer value (200) wins on both, and there is exactly one row per device.
    for (const d of [A, B]) {
      const snaps = d.all<{ value: number }>(`SELECT value FROM ${T.monthlySnapshot} WHERE month='2026-01'`);
      expect(snaps).toHaveLength(1);
      expect(snaps[0].value).toBe(200);
    }
  });

  it("propagates a deletion via tombstone unless the peer edited after the delete", async () => {
    A.db.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('ToDelete', 'bank_savings')`);
    A.db.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('ToKeep', 'bank_savings')`);
    await syncOneWay(A, B, "2026-02-01 10:00:00");

    // A deletes ToDelete at 03-01; B edits ToKeep's name (no conflict).
    A.db.exec(`UPDATE ${T.accounts} SET updated_at='2026-02-15 00:00:00' WHERE name IN ('ToDelete','ToKeep')`);
    A.db.exec(`DELETE FROM ${T.accounts} WHERE name='ToDelete'`); // writes a tombstone at 'now'

    await syncOneWay(A, B, "2026-03-02 00:00:00");

    const names = B.all<{ name: string }>(`SELECT name FROM ${T.accounts} ORDER BY name`).map((r) => r.name);
    expect(names).toEqual(["ToKeep"]); // ToDelete removed on B
  });

  it("lets an edit beat a stale delete (edit-after-delete keeps the row)", async () => {
    A.db.exec(`INSERT INTO ${T.accounts} (name, type) VALUES ('Contested', 'bank_savings')`);
    await syncOneWay(A, B, "2026-02-01 10:00:00");

    // A deletes early; B edits the same row LATER than the deletion.
    A.db.exec(`DELETE FROM ${T.accounts} WHERE name='Contested'`);
    const tomb = A.all<{ deleted_at: string }>(`SELECT deleted_at FROM ${T.syncTombstones}`)[0].deleted_at;
    // Force B's edit to be strictly after the tombstone.
    B.db.exec(`UPDATE ${T.accounts} SET name='Contested-edited', updated_at='2099-01-01 00:00:00' WHERE name='Contested'`);

    await syncOneWay(A, B, "2026-03-02 00:00:00");
    expect(tomb).toBeTruthy();
    expect(B.all<{ name: string }>(`SELECT name FROM ${T.accounts}`).map((r) => r.name)).toEqual(["Contested-edited"]);
  });

  it("invokes credential and blob callbacks for vault entries and documents", async () => {
    // A has an account with a credential pointer and a document with a blob.
    A.db.exec(`INSERT INTO ${T.vaultEntries} (label, stronghold_key) VALUES ('GMail', 'cred-key-1')`);
    const ve = A.all<{ id: number }>(`SELECT id FROM ${T.vaultEntries}`)[0].id;
    A.db.exec(`INSERT INTO ${T.accounts} (name, type, credential_id) VALUES ('Acc', 'bank_savings', ${ve})`);
    A.db.exec(`INSERT INTO ${T.documents} (type, title, file_name) VALUES ('will', 'My Will', 'local-file-A')`);

    const creds: SyncCredential = { label: "GMail", username: "u", password: "p" };
    const seenCreds: Record<string, SyncCredential> = {};
    const blobCalls: { name: string; bytes: number[] }[] = [];

    const bundle = await buildBundle(A.sync, {
      deviceId: A.deviceId,
      createdAt: "2026-02-01 10:00:00",
      readCredential: async (k) => (k === "cred-key-1" ? creds : null),
      readBlob: async (fn) => (fn === "local-file-A" ? new Uint8Array([1, 2, 3]) : null),
    });

    const summary = await applyBundle(B.sync, bundle, {
      localDeviceId: B.deviceId,
      onCredential: async (key, c) => {
        seenCreds[key] = c;
      },
      onBlob: async (bytes) => {
        blobCalls.push({ name: "resealed", bytes: Array.from(bytes) });
        return "local-file-B";
      },
    });

    expect(seenCreds["cred-key-1"]).toEqual(creds);
    expect(blobCalls).toEqual([{ name: "resealed", bytes: [1, 2, 3] }]);
    // Document points at the re-sealed local file, not A's file name.
    expect(B.all<{ file_name: string }>(`SELECT file_name FROM ${T.documents}`)[0].file_name).toBe("local-file-B");
    expect(summary.added).toBeGreaterThan(0);
  });
});
