import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createEntitiesStore } from "sharedcorelib/entities";
import type { SqlDb } from "sharedcorelib/db";
import {
  createPersonFacetStore,
  linkLocalPerson,
  suggestPersonDuplicates,
  publishLocalAsset,
  aggregateNetWorth,
  type LocalPersonLike,
} from "./sharedEntities";

/** A real in-memory SqlDb (node:sqlite) so entity SQL actually executes. */
function memDb(): { sql: SqlDb; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  const sql: SqlDb = {
    select: async <T = Record<string, unknown>>(q: string, params: unknown[] = []) =>
      raw.prepare(q).all(...(params as never[])) as T[],
    execute: async (q: string, params: unknown[] = []) => {
      const r = params.length ? raw.prepare(q).run(...(params as never[])) : raw.exec(q) as unknown;
      const rr = (r ?? { changes: 0, lastInsertRowid: 0 }) as { changes?: number; lastInsertRowid?: number };
      return { rowsAffected: Number(rr.changes ?? 0), lastInsertId: Number(rr.lastInsertRowid ?? 0) };
    },
  };
  return { sql, raw };
}

let sql: SqlDb;
let entities: ReturnType<typeof createEntitiesStore>;
let facets: ReturnType<typeof createPersonFacetStore>;

beforeEach(async () => {
  ({ sql } = memDb());
  entities = createEntitiesStore(sql, { appId: "myfinance" });
  facets = createPersonFacetStore(sql);
  await entities.ensure();
  await facets.ensure();
});

const priya: LocalPersonLike = {
  id: 1, name: "Priya Das", relationship: "Spouse", phone: "+91 88888",
  email: "priya@x.com", access_tier: 2, id_proof_ref: "AADHAAR-xxxx", notes: "executor",
};

describe("Phase 1 — adopt shared person (explicit-reference + facet)", () => {
  it("links a local person to a shared person identity, finance data lives in the facet", async () => {
    const key = await linkLocalPerson(entities, facets, priya);

    const person = await entities.getPerson(key);
    expect(person).toBeTruthy();
    expect(person!.display_name).toBe("Priya Das");
    expect(person!.contact_phone).toBe("+91 88888");
    // identity row must NOT carry finance-specific fields
    expect(person as unknown as Record<string, unknown>).not.toHaveProperty("access_tier");

    const facet = await facets.get(key);
    expect(facet!.access_tier).toBe(2);
    expect(facet!.id_proof_ref).toBe("AADHAAR-xxxx");
    expect(facet!.local_person_id).toBe(1);
  });

  it("self resolves to the canonical 'self' key (shared with the ICE card)", async () => {
    const key = await linkLocalPerson(entities, facets, { id: 9, name: "Me", isSelf: true });
    expect(key).toBe("self");
  });

  it("explicit-reference: re-linking the same key updates, never creates a duplicate", async () => {
    await linkLocalPerson(entities, facets, priya);
    await linkLocalPerson(entities, facets, { ...priya, phone: "+91 77777" });
    const people = await entities.listPeople();
    expect(people).toHaveLength(1);
    expect((await entities.getPerson(people[0].person_key))!.contact_phone).toBe("+91 77777");
  });

  it("suggestDuplicates SUGGESTS likely matches but never auto-merges", async () => {
    // a person seeded by another app (e.g. myHealth) with the same name
    await entities.upsertPerson({ person_key: "priya-das-health", display_name: "Priya Das" });
    await linkLocalPerson(entities, facets, priya);

    const suggestions = await suggestPersonDuplicates(entities, {
      name: "Priya Das", person_key: "priya-das",
    });
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.some((s) => s.reasons.includes("same-name"))).toBe(true);
    // both rows still exist — no auto-merge happened
    expect(await entities.listPeople()).toHaveLength(2);
  });
});

describe("Phase 2 — shared asset + net-worth aggregation", () => {
  it("aggregates net worth across assets contributed by multiple apps", async () => {
    // myFinance's own account assets
    await publishLocalAsset(entities, { id: "myfinance:account:1", label: "HDFC Savings", value: 500000 });
    await publishLocalAsset(entities, { id: "myfinance:account:2", label: "ICICI FD", value: 200000 });
    // a cross-app asset contributed by myHome (property), owner self
    await createEntitiesStore(sql, { appId: "myhome" }).upsertAsset({
      id: "myhome:property:1", type: "property", label: "Flat", value: 9000000, owner: "self",
    });

    const agg = await aggregateNetWorth(entities, "self");
    expect(agg.total).toBe(500000 + 200000 + 9000000);
    expect(agg.byApp.myfinance).toBe(700000);
    expect(agg.byApp.myhome).toBe(9000000);
    expect(agg.assets).toHaveLength(3);
  });

  it("only sums assets owned by the requested person", async () => {
    await publishLocalAsset(entities, { id: "a1", label: "Mine", value: 100, ownerKey: "self" });
    await publishLocalAsset(entities, { id: "a2", label: "Sibling's", value: 999, ownerKey: "amit" });
    const agg = await aggregateNetWorth(entities, "self");
    expect(agg.total).toBe(100);
  });
});
