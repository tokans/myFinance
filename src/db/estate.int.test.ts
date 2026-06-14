import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createIceStore } from "sharedcorelib/ice";
import { T } from "./tables";
import { buildSuiteTestDb } from "./__tests__/suiteTestDb";

const h = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

// health.ts now delegates to the shared common ICE card via sharedDb.iceStore() —
// point that at the test DB (the Tauri-gated real one returns null in node).
vi.mock("./sharedDb", () => ({
  iceStore: async () => {
    const raw = h.db!;
    const adapt = {
      select: async (sql: string, params: unknown[] = []) => raw.prepare(sql).all(...(params as never[])),
      execute: async (sql: string, params: unknown[] = []) => {
        if (params.length) { const r = raw.prepare(sql).run(...(params as never[])); return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) }; }
        raw.exec(sql); return {};
      },
    };
    return createIceStore(adapt as never);
  },
}));

vi.mock("./client", async () => ({
  T: (await import("./tables")).T,
  query: async (sql: string, params: unknown[] = []) =>
    h.db!.prepare(sql).all(...(params as never[])),
  exec: async (sql: string, params: unknown[] = []) => {
    if (params.length) h.db!.prepare(sql).run(...(params as never[]));
    else h.db!.exec(sql);
  },
  getDb: async () => ({
    execute: async (sql: string, params: unknown[] = []) => {
      const r = h.db!.prepare(sql).run(...(params as never[]));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    select: async (sql: string, params: unknown[] = []) =>
      h.db!.prepare(sql).all(...(params as never[])),
  }),
}));

import { createPerson, listPeople, updatePerson, deletePerson, countPeople } from "./people";
import { createAccount, getAccount } from "./accounts";
import { addHolding, listHoldingsWithPeople, setHoldingMode } from "./holdings";
import { addDocumentMetaOnly, listDocuments, deleteDocument } from "./documents";
import { getSetting, setSetting, getNumberSetting } from "./settings";
import { createPolicy, listPolicies, deletePolicy } from "./insurance";
import { getHealthProfile, upsertHealthProfile } from "./health";
import { getWillMeta, upsertWillMeta } from "./will";
import { addGrant, listGrants, logAudit, listAudit } from "./access";
import { addLifeEvent, listLifeEvents, deleteLifeEvent } from "./lifeEvents";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("people", () => {
  it("creates, lists (name-sorted), updates, deletes and counts", async () => {
    await createPerson({ name: "Zara", relationship: "Sibling" });
    const id = await createPerson({ name: "Amit", phone: "123", access_tier: 2 });
    expect(await countPeople()).toBe(2);

    const list = await listPeople();
    expect(list.map((p) => p.name)).toEqual(["Amit", "Zara"]); // COLLATE NOCASE order
    expect(list.find((p) => p.id === id)!.access_tier).toBe(2);

    await updatePerson(id, { name: "Amit Das", access_tier: 1 });
    expect((await getPersonById(id)).name).toBe("Amit Das");

    await deletePerson(id);
    expect(await countPeople()).toBe(1);
  });

  async function getPersonById(id: number) {
    return (await listPeople()).find((p) => p.id === id)!;
  }
});

describe("holdings", () => {
  it("links nominee to account with person name, and sets holding mode", async () => {
    const acc = await createAccount({ name: "HDFC", type: "bank_savings" });
    const person = await createPerson({ name: "Priya", relationship: "Spouse" });
    await addHolding({ account_id: acc, person_id: person, role: "nominee", share_pct: 100 });

    const rows = await listHoldingsWithPeople();
    expect(rows).toHaveLength(1);
    expect(rows[0].person_name).toBe("Priya");
    expect(rows[0].share_pct).toBe(100);

    await setHoldingMode(acc, "either_or_survivor");
    expect((await getAccount(acc))!.holding_mode).toBe("either_or_survivor");
  });

  it("cascades holdings away when the account is deleted (FK)", async () => {
    const acc = await createAccount({ name: "X", type: "cash" });
    const person = await createPerson({ name: "P" });
    await addHolding({ account_id: acc, person_id: person, role: "nominee", share_pct: 50 });
    h.db!.exec(`DELETE FROM ${T.accounts} WHERE id = ${acc}`);
    expect(await listHoldingsWithPeople()).toHaveLength(0);
  });
});

describe("documents (metadata)", () => {
  it("filters by account and by type", async () => {
    const acc = await createAccount({ name: "A", type: "bank_savings" });
    await addDocumentMetaOnly({ type: "will", title: "My Will" });
    await addDocumentMetaOnly({ type: "statement", title: "Stmt", account_id: acc });

    expect(await listDocuments({ accountId: acc })).toHaveLength(1);
    expect(await listDocuments({ types: ["will", "codicil", "probate"] })).toHaveLength(1);
    expect((await listDocuments())).toHaveLength(2);
  });

  it("deletes a metadata-only document", async () => {
    const id = await addDocumentMetaOnly({ type: "other", title: "doc" });
    await deleteDocument(id);
    expect(await listDocuments()).toHaveLength(0);
  });
});

describe("settings helpers", () => {
  it("round-trips strings and numbers, null when unset", async () => {
    expect(await getSetting("annual_income")).toBeNull();
    await setSetting("annual_income", "1200000");
    expect(await getSetting("annual_income")).toBe("1200000");
    expect(await getNumberSetting("annual_income")).toBe(1200000);
    await setSetting("annual_income", "");
    expect(await getNumberSetting("annual_income")).toBeNull();
  });
});

describe("insurance", () => {
  it("creates, lists and deletes policies", async () => {
    const id = await createPolicy({ kind: "term", insurer: "LIC", sum_assured: 5000000, renewal_date: "2026-09-01" });
    const list = await listPolicies();
    expect(list).toHaveLength(1);
    expect(list[0].insurer).toBe("LIC");
    await deletePolicy(id);
    expect(await listPolicies()).toHaveLength(0);
  });
});

describe("single-row upserts", () => {
  it("health profile upserts in place on the shared ICE card", async () => {
    await upsertHealthProfile({ blood_group: "O+", organ_donor: true });
    let p = await getHealthProfile();
    expect(p!.blood_group).toBe("O+");
    expect(p!.organ_donor).toBe(1);
    await upsertHealthProfile({ blood_group: "A+", organ_donor: false });
    p = await getHealthProfile();
    expect(p!.blood_group).toBe("A+");
    expect(p!.organ_donor).toBe(0);
    // Stored ONCE suite-wide on the common ICE card (person_key 'self'), not a per-app table.
    const rows = h.db!.prepare("SELECT COUNT(*) AS n FROM common_ice_card WHERE person_key = 'self'").all() as { n: number }[];
    expect(Number(rows[0].n)).toBe(1);
  });

  it("will meta upserts and stores executor link", async () => {
    const exec = await createPerson({ name: "Executor Person" });
    await upsertWillMeta({ has_will: true, executor_person_id: exec, registered: true, location_of_original: "Locker" });
    const w = await getWillMeta();
    expect(w!.has_will).toBe(1);
    expect(w!.executor_person_id).toBe(exec);
    expect(w!.location_of_original).toBe("Locker");
  });
});

describe("access + audit", () => {
  it("grants access with person name and appends audit entries", async () => {
    const person = await createPerson({ name: "Trusted" });
    await addGrant(person, 2, "full register");
    const grants = await listGrants();
    expect(grants).toHaveLength(1);
    expect(grants[0].person_name).toBe("Trusted");
    expect(grants[0].tier).toBe(2);

    await logAudit("export_package", "tier 2");
    await logAudit("checkin", "2026-05-31");
    const audit = await listAudit();
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.action)).toContain("export_package");
  });
});

describe("life events", () => {
  it("adds, lists and deletes", async () => {
    const id = await addLifeEvent("marriage", "2026-02-14", "Wedding");
    await addLifeEvent("new_loan", "2026-03-01", null);
    expect(await listLifeEvents()).toHaveLength(2);
    await deleteLifeEvent(id);
    const rest = await listLifeEvents();
    expect(rest).toHaveLength(1);
    expect(rest[0].type).toBe("new_loan");
  });
});
