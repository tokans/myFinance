import { describe, it, expect, beforeEach } from "vitest";
import { applyBundle, type SyncDb } from "./merge";
import { buildBundle } from "./bundle";
import type { Bundle } from "./spec";
import { T } from "@/db/tables";
import { buildSuiteTestDb } from "@/db/__tests__/suiteTestDb";

/**
 * Compartment-aware sync activation (K4). The app's own SPEC-driven merge engine now
 * honors the core multiuser compartment primitives: a row tagged `private:<userId>` reaches
 * ONLY that user (filtered on send when `recipientUserId` is set; skipped on ingest when
 * `localUserId` is set). Untagged/`shared` rows, or omitted options, sync exactly as
 * pre-K4 — proven by the unchanged 9-test merge.test.ts suite plus the inert cases here.
 */
async function device(deviceId: string) {
  const db = await buildSuiteTestDb();
  db.exec(`UPDATE ${T.settings} SET value = '${deviceId}' WHERE key = 'device_id'`);
  const sync: SyncDb = {
    async select(sql, params = []) {
      return db.prepare(sql).all(...(params as never[])) as never;
    },
    async execute(sql, params = []) {
      const r = db.prepare(sql).run(...(params as never[]));
      return { lastInsertId: Number(r.lastInsertRowid), rowsAffected: Number(r.changes) };
    },
  };
  const all = <R>(sql: string, p: unknown[] = []): R[] => db.prepare(sql).all(...(p as never[])) as R[];
  return { db, deviceId, sync, all };
}

/** A minimal valid bundle carrying `people` rows with compartment tags. */
function peopleBundle(deviceId: string, rows: Record<string, unknown>[]): Bundle {
  return {
    version: 1,
    device_id: deviceId,
    created_at: "2026-06-12 10:00:00",
    tables: { people: rows },
    tombstones: [],
    credentials: {},
    blobs: {},
  };
}

const A_ID = "11111111111111111111111111111111";
const B_ID = "22222222222222222222222222222222";

describe("compartment-aware sync (receive side: localUserId)", () => {
  let B: Awaited<ReturnType<typeof device>>;
  beforeEach(async () => {
    B = await device(B_ID);
  });

  it("skips a foreign member's private row on ingest when localUserId is set", async () => {
    const bundle = peopleBundle(A_ID, [
      { sync_id: "p-shared", name: "Shared Contact", access_tier: 0, created_at: '2026-06-12 09:00:00', compartment: "shared", updated_at: "2026-06-12 09:00:00" },
      { sync_id: "p-mine", name: "My Private", access_tier: 0, created_at: '2026-06-12 09:00:00', compartment: "private:bob", updated_at: "2026-06-12 09:00:00" },
      { sync_id: "p-theirs", name: "Alice Private", access_tier: 0, created_at: '2026-06-12 09:00:00', compartment: "private:alice", updated_at: "2026-06-12 09:00:00" },
    ]);
    const summary = await applyBundle(B.sync, bundle, { localDeviceId: B_ID, localUserId: "bob" });

    const names = B.all<{ name: string }>(`SELECT name FROM ${T.people} ORDER BY name`).map((r) => r.name);
    // Shared + bob's own private land; alice's private is skipped for bob.
    expect(names).toEqual(["My Private", "Shared Contact"]);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
  });

  it("INERT for single-user: without localUserId, every row applies (pre-K4 behavior)", async () => {
    const bundle = peopleBundle(A_ID, [
      { sync_id: "p-shared", name: "Shared", access_tier: 0, created_at: '2026-06-12 09:00:00', compartment: "shared", updated_at: "2026-06-12 09:00:00" },
      { sync_id: "p-theirs", name: "Alice Private", access_tier: 0, created_at: '2026-06-12 09:00:00', compartment: "private:alice", updated_at: "2026-06-12 09:00:00" },
    ]);
    await applyBundle(B.sync, bundle, { localDeviceId: B_ID });
    const count = B.all<{ n: number }>(`SELECT COUNT(*) n FROM ${T.people}`)[0].n;
    expect(count).toBe(2); // both rows applied — compartment filtering off
  });

  it("untagged rows (no compartment column) always apply (treated as shared)", async () => {
    const bundle = peopleBundle(A_ID, [
      { sync_id: "p-1", name: "Untagged", access_tier: 0, created_at: '2026-06-12 09:00:00', updated_at: "2026-06-12 09:00:00" },
    ]);
    await applyBundle(B.sync, bundle, { localDeviceId: B_ID, localUserId: "bob" });
    const count = B.all<{ n: number }>(`SELECT COUNT(*) n FROM ${T.people}`)[0].n;
    expect(count).toBe(1);
  });
});

describe("compartment-aware sync (send side: recipientUserId)", () => {
  it("INERT for single-user: buildBundle without recipientUserId emits all rows", async () => {
    const A = await device(A_ID);
    A.db.exec(`INSERT INTO ${T.people} (name, relationship) VALUES ('Alice', 'spouse')`);
    A.db.exec(`INSERT INTO ${T.people} (name, relationship) VALUES ('Bob', 'self')`);
    const bundle = await buildBundle(A.sync, { deviceId: A_ID, createdAt: "2026-06-12 10:00:00" });
    expect((bundle.tables.people ?? []).length).toBe(2);
  });

  it("with recipientUserId set, untagged (shared) rows still travel — inert until rows are tagged", async () => {
    const A = await device(A_ID);
    A.db.exec(`INSERT INTO ${T.people} (name, relationship) VALUES ('Alice', 'spouse')`);
    const bundle = await buildBundle(A.sync, {
      deviceId: A_ID,
      createdAt: "2026-06-12 10:00:00",
      recipientUserId: "bob",
    });
    // No compartment column on the people SPEC yet → rows are shared → still emitted.
    expect((bundle.tables.people ?? []).length).toBe(1);
  });
});
