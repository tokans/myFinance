import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createEntitiesStore } from "sharedcorelib/entities";
import type { SqlDb } from "sharedcorelib/db";
import {
  suggestPersonDuplicates,
  publishLocalAsset,
  aggregateNetWorth,
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

beforeEach(async () => {
  ({ sql } = memDb());
  entities = createEntitiesStore(sql, { appId: "myfinance" });
  await entities.ensure();
});

describe("guided-merge duplicate suggestion (explicit-reference, no auto-merge)", () => {
  it("SUGGESTS likely matches but never auto-merges", async () => {
    // A person seeded by another app (e.g. myHealth) with the same name…
    await entities.upsertPerson({ person_key: "priya-das-health", display_name: "Priya Das" });
    // …and the finance contact for the same human (canonical `mf-<id>` keying, written by people.ts).
    await entities.upsertPerson({ person_key: "mf-1", display_name: "Priya Das", contact_phone: "+91 88888" });

    const suggestions = await suggestPersonDuplicates(entities, {
      name: "Priya Das", person_key: "mf-1",
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
