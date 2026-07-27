/**
 * Person-spine migration (finding 2.1, invariant 6): lifting myfinance_people identity onto
 * the shared common_person spine + the finance facet, collapsing the table to a thin link.
 *
 * The fixtures build the OLD-shape suite (descriptors + aux v1/v2) via `ensureSuiteSchema`,
 * seed a populated estate (people + every FK reference: holdings/will/incapacity/insurance/
 * access_grants/documents/reminders), then run the real `migratePersonSpine` engine — proving
 * fresh-install, populated-migration, idempotency, count+checksum verify, FK survival across
 * the whole estate, and access_tier disclosure preservation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { SqlDb } from "sharedcorelib/db";
import { ensureSuiteSchema } from "./schemas";
import { migratePersonSpine, personKeyForLocal } from "./personSpine";
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

/** A fresh OLD-shape suite DB (people table still carries identity columns), pre-migration. */
async function oldShapeSuite(): Promise<{ raw: DatabaseSync; sql: SqlDb }> {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  const sql = adapt(raw);
  await ensureSuiteSchema(sql);
  return { raw, sql };
}

let raw: DatabaseSync;
let sql: SqlDb;

beforeEach(async () => { ({ raw, sql } = await oldShapeSuite()); });

const cols = (table: string): string[] =>
  (raw.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((r) => r.name);

describe("migratePersonSpine", () => {
  it("fresh install: empty table → thin link, ledgered", async () => {
    const res = await migratePersonSpine({ suite: sql });
    expect(res.status).toBe("migrated");
    expect(res.rows).toBe(0);
    // Identity columns dropped; person_key added.
    expect(cols(T.people)).toContain("person_key");
    expect(cols(T.people)).not.toContain("name");
    expect(cols(T.people)).not.toContain("access_tier");
  });

  it("idempotent: a second run no-ops (already thin / ledgered)", async () => {
    await migratePersonSpine({ suite: sql });
    const again = await migratePersonSpine({ suite: sql });
    expect(again.status).toBe("already-done");
  });

  it("lifts a populated estate onto the spine, preserving every FK + access_tier", async () => {
    // Seed people (old shape) + the full web of FK references at known integer ids.
    raw.exec(`
      INSERT INTO ${T.people} (id, name, relationship, phone, email, id_proof_ref, access_tier, notes, created_at, sync_id)
        VALUES
          (1, 'Asha',  'spouse',   '+91-1', 'asha@x.com', 'AAD-1', 2, 'executor', '2024-01-01 09:00:00', 'p1'),
          (2, 'Bimal', 'sibling',  '+91-2', NULL,         NULL,    0, NULL,       '2024-01-02 09:00:00', 'p2'),
          (3, 'Asha',  'cousin',   '+91-3', NULL,         NULL,    1, NULL,       '2024-01-03 09:00:00', 'p3');
      INSERT INTO ${T.accounts} (id, name, type) VALUES (1, 'HDFC', 'bank_savings');
      INSERT INTO ${T.holdings} (id, account_id, person_id, role, share_pct) VALUES (1, 1, 1, 'nominee', 100);
      INSERT INTO ${T.holdings} (id, account_id, person_id, role, share_pct) VALUES (2, 1, 2, 'beneficiary', 50);
      INSERT INTO ${T.willMeta} (id, has_will, executor_person_id, guardian_person_id) VALUES (1, 1, 1, 3);
      INSERT INTO ${T.incapacityMeta} (id, poa_attorney_person_id) VALUES (1, 2);
      INSERT INTO ${T.insurancePolicies} (id, kind, insurer, sum_assured, claims_contact_person_id)
        VALUES (1, 'health', 'Star', 500000, 1);
      INSERT INTO ${T.accessGrants} (id, person_id, tier, scope) VALUES (1, 1, 2, 'full');
      INSERT INTO ${T.documents} (id, type, title, person_id) VALUES (1, 'will', 'My Will', 1);
      INSERT INTO ${T.reminders} (id, type, title, due_date, person_id) VALUES (1, 'custom', 'Call Asha', '2026-09-01', 1);
    `);

    const res = await migratePersonSpine({ suite: sql });
    expect(res.status).toBe("migrated");
    expect(res.rows).toBe(3);

    // Identity is now single-sourced on common_person, keyed mf-<id> (collision-free: two Ashas).
    const people = raw.prepare(`SELECT person_key, display_name, relationship_to_self, contact_phone, contact_email FROM common_person ORDER BY person_key`).all() as Record<string, unknown>[];
    expect(people).toEqual([
      { person_key: "mf-1", display_name: "Asha", relationship_to_self: "spouse", contact_phone: "+91-1", contact_email: "asha@x.com" },
      { person_key: "mf-2", display_name: "Bimal", relationship_to_self: "sibling", contact_phone: "+91-2", contact_email: null },
      { person_key: "mf-3", display_name: "Asha", relationship_to_self: "cousin", contact_phone: "+91-3", contact_email: null },
    ]);

    // Finance estate fields (access_tier/id_proof/notes) live on the facet, keyed by person_key.
    const facets = raw.prepare(`SELECT person_key, access_tier, id_proof_ref, notes, local_person_id FROM ${T.personFacet} ORDER BY person_key`).all() as Record<string, unknown>[];
    expect(facets).toEqual([
      { person_key: "mf-1", access_tier: 2, id_proof_ref: "AAD-1", notes: "executor", local_person_id: 1 },
      { person_key: "mf-2", access_tier: 0, id_proof_ref: null, notes: null, local_person_id: 2 },
      { person_key: "mf-3", access_tier: 1, id_proof_ref: null, notes: null, local_person_id: 3 },
    ]);

    // The thin link keeps the integer id ↔ person_key map; identity columns are gone.
    expect(cols(T.people)).not.toContain("name");
    const links = raw.prepare(`SELECT id, person_key FROM ${T.people} ORDER BY id`).all();
    expect(links).toEqual([
      { id: 1, person_key: "mf-1" }, { id: 2, person_key: "mf-2" }, { id: 3, person_key: "mf-3" },
    ]);

    // Every estate FK still resolves to the SAME integer id (no remap needed, ids preserved).
    const holdings = raw.prepare(`SELECT person_id, role FROM ${T.holdings} ORDER BY id`).all();
    expect(holdings).toEqual([{ person_id: 1, role: "nominee" }, { person_id: 2, role: "beneficiary" }]);
    const will = raw.prepare(`SELECT executor_person_id, guardian_person_id FROM ${T.willMeta} WHERE id=1`).get();
    expect(will).toEqual({ executor_person_id: 1, guardian_person_id: 3 });
    const inc = raw.prepare(`SELECT poa_attorney_person_id FROM ${T.incapacityMeta} WHERE id=1`).get();
    expect(inc).toEqual({ poa_attorney_person_id: 2 });
    const pol = raw.prepare(`SELECT claims_contact_person_id FROM ${T.insurancePolicies} WHERE id=1`).get();
    expect(pol).toEqual({ claims_contact_person_id: 1 });
    const grant = raw.prepare(`SELECT person_id, tier FROM ${T.accessGrants} WHERE id=1`).get();
    expect(grant).toEqual({ person_id: 1, tier: 2 });
    const doc = raw.prepare(`SELECT person_id FROM ${T.documents} WHERE id=1`).get();
    expect(doc).toEqual({ person_id: 1 });
    const rem = raw.prepare(`SELECT person_id FROM ${T.reminders} WHERE id=1`).get();
    expect(rem).toEqual({ person_id: 1 });
  });

  it("FK cascade/SET NULL semantics survive: deleting a link row drives the children", async () => {
    raw.exec(`
      INSERT INTO ${T.people} (id, name, access_tier) VALUES (1, 'Asha', 2);
      INSERT INTO ${T.accounts} (id, name, type) VALUES (1, 'HDFC', 'bank_savings');
      INSERT INTO ${T.holdings} (id, account_id, person_id, role) VALUES (1, 1, 1, 'nominee');
      INSERT INTO ${T.willMeta} (id, has_will, executor_person_id) VALUES (1, 1, 1);
    `);
    await migratePersonSpine({ suite: sql });

    // Delete the thin link row: holdings CASCADE away, will_meta executor SET NULL — unchanged.
    raw.exec(`DELETE FROM ${T.people} WHERE id = 1`);
    expect((raw.prepare(`SELECT COUNT(*) n FROM ${T.holdings}`).get() as { n: number }).n).toBe(0);
    expect((raw.prepare(`SELECT executor_person_id FROM ${T.willMeta} WHERE id=1`).get() as { executor_person_id: number | null }).executor_person_id).toBeNull();
  });

  it("verify guards content: a checksum mismatch rolls back without dropping columns", async () => {
    raw.exec(`INSERT INTO ${T.people} (id, name, access_tier) VALUES (1, 'Asha', 2);`);
    // Sabotage: a faulty SqlDb whose facet read returns the WRONG access_tier so the post-copy
    // verify checksum can't match the pre-migration sample.
    const faulty: SqlDb = {
      select: async <R = Record<string, unknown>>(s: string, p: unknown[] = []) => {
        const rows = (await sql.select<Record<string, unknown>>(s, p));
        if (/FROM "?myfinance_person_facet"?/.test(s)) {
          return rows.map((r) => ({ ...r, access_tier: 999 })) as R[];
        }
        return rows as R[];
      },
      execute: sql.execute,
    };
    await expect(migratePersonSpine({ suite: faulty })).rejects.toThrow(/verify failed/);
    // Rolled back: the identity columns are STILL present, data intact (no loss).
    expect(cols(T.people)).toContain("name");
    expect((raw.prepare(`SELECT name FROM ${T.people} WHERE id=1`).get() as { name: string }).name).toBe("Asha");
  });

  it("personKeyForLocal is stable, unique per id, and never 'self'", () => {
    expect(personKeyForLocal(1)).toBe("mf-1");
    expect(personKeyForLocal(42)).toBe("mf-42");
    expect(personKeyForLocal(1)).not.toBe("self");
  });
});
