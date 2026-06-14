import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createIceStore } from "sharedcorelib/ice";
import { T } from "./tables";
import { buildSuiteTestDb } from "./__tests__/suiteTestDb";

const h = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("./client", async () => {
  const { T: tables } = await import("./tables");
  return {
    T: tables,
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
  };
});

// health.ts delegates to the shared ICE card via sharedDb.iceStore() — back it with the test DB.
vi.mock("./sharedDb", () => ({
  iceStore: async () => createIceStore({
    select: async (sql: string, params: unknown[] = []) => h.db!.prepare(sql).all(...(params as never[])),
    execute: async (sql: string, params: unknown[] = []) => {
      if (params.length) { const r = h.db!.prepare(sql).run(...(params as never[])); return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) }; }
      h.db!.exec(sql); return {};
    },
  } as never),
}));

// Documents clear deletes blob files; there is no vault in the test harness, so stub it out.
vi.mock("@/vault/documentFiles", () => ({
  saveBlob: async () => "blob",
  deleteBlob: async () => {},
}));

import { clearAllData, countAllData } from "./maintenance";
import { createAccount } from "./accounts";
import { upsertSnapshot } from "./snapshots";
import { createPerson } from "./people";
import { addHolding } from "./holdings";
import { addGrant } from "./access";
import { createPolicy } from "./insurance";
import { upsertHealthProfile } from "./health";
import { upsertWillMeta } from "./will";
import { upsertIncapacityMeta } from "./incapacity";
import { addLifeEvent } from "./lifeEvents";
import { createReminder } from "./reminders";
import { createGoal } from "./goals";
import { upsertTaxYear, insertIncome } from "./tax";
import { addDocumentMetaOnly } from "./documents";
import { setSetting, getSetting } from "./settings";

function count(table: string): number {
  return Number((h.db!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
}

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("clearAllData", () => {
  it("wipes every data table (including people-referencing children) but keeps settings", async () => {
    // Seed across the whole app, including rows that reference people/accounts.
    const acc = await createAccount({ name: "HDFC", type: "bank_savings" });
    await upsertSnapshot({ account_id: acc, month: "2026-01", value: 1000 });
    const person = await createPerson({ name: "Priya", relationship: "Spouse" });
    await addHolding({ account_id: acc, person_id: person, role: "nominee", share_pct: 100 });
    await addGrant(person, 1, null);
    await createPolicy({ kind: "term", insurer: "LIC", sum_assured: 100000, claims_contact_person_id: person });
    await upsertHealthProfile({ blood_group: "O+" });
    await upsertWillMeta({ has_will: true, executor_person_id: person });
    await upsertIncapacityMeta({ poa_attorney_person_id: person });
    await addLifeEvent("marriage", "2026-02-01", null);
    await createReminder({ title: "Renew", due_date: "2026-03-01" });
    await createGoal({ name: "Fund", target_amount: 5000 });
    await upsertTaxYear("2026-27");
    await insertIncome({ ay: "2026-27", head: "salary", label: "Salary", amount: 9, source_path: null, note: null });
    await addDocumentMetaOnly({ type: "will", title: "Will", person_id: person, account_id: acc });
    await setSetting("currency", "INR");

    expect(await countAllData()).toBeGreaterThan(0);

    await clearAllData();

    for (const t of [
      T.accounts, T.monthlySnapshot, T.people, T.holdings, T.accessGrants, T.auditLog,
      T.insurancePolicies, T.willMeta, T.incapacityMeta, T.lifeEvents,
      T.reminders, T.goals, T.taxYears, T.taxIncome, T.documents,
    ]) {
      expect(count(t), `${t} should be empty`).toBe(0);
    }
    // The medical card lives on the shared ICE card now; clearHealthProfile removed the self row.
    expect(count("common_ice_card")).toBe(0);
    expect(await countAllData()).toBe(0);

    // Settings are intentionally preserved.
    expect(await getSetting("currency")).toBe("INR");
  });
});
