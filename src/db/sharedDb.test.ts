import { describe, it, expect } from "vitest";
import { validateDescriptor } from "sharedcorelib/schema";
import { registerSchemas, createSharedDb, REGISTRY_TABLE, type SqlDb } from "sharedcorelib/db";
import { MYFINANCE_SCHEMAS } from "./schemas";

/** In-memory fake SqlDb: records calls, returns seeded rows for data selects. */
function fakeDb({ dataRows = [] as unknown[] } = {}) {
  const calls = { execute: [] as string[], select: [] as string[] };
  const db: SqlDb = {
    select: async (sql) => {
      calls.select.push(sql);
      return (sql.includes(REGISTRY_TABLE) ? [] : dataRows) as never;
    },
    execute: async (sql) => { calls.execute.push(sql); return {}; },
  };
  return { db, calls };
}

describe("myFinance shared-DB schemas", () => {
  it("every descriptor is valid (shape + DPDP)", () => {
    for (const s of MYFINANCE_SCHEMAS) {
      const r = validateDescriptor(s);
      expect(r.ok, `${s.namespace}#${s.name}: ${r.issues.map((i) => i.message).join(", ")}`).toBe(true);
    }
  });

  it("registerSchemas creates the namespaced legacy tables", async () => {
    const { db, calls } = fakeDb();
    const res = await registerSchemas(db, MYFINANCE_SCHEMAS);
    expect(res.registry["myfinance#Accounts"]).toBeTruthy();
    expect(res.registry["myfinance#MonthlySnapshots"]).toBeTruthy();
    // The descriptor shell is created via dbAlias (the canonical DDL is built by aux-SQL).
    expect(calls.execute.some((s) => /CREATE TABLE IF NOT EXISTS "myfinance_accounts"/.test(s))).toBe(true);
  });

  it("HealthProfile ADOPTS the common ICE card (no table created)", async () => {
    const { db } = fakeDb();
    const res = await registerSchemas(db, MYFINANCE_SCHEMAS);
    expect(res.adopted).toContain("myfinance#HealthProfile");
  });

  it("a cross-app reader below the table's confidentiality cannot read it", async () => {
    const { db } = fakeDb({
      dataRows: [{ id: 1, name: "Savings", type: "bank_savings", contact: "x", updated_at: "2026-06-06" }],
    });
    const { registry } = await registerSchemas(db, MYFINANCE_SCHEMAS);
    // Accounts is Confidential; an Internal-granted cross-app reader is denied entirely.
    const reader = createSharedDb({ db, appId: "myhealth", grantedLevel: "Internal", registry });
    await expect(reader.read("myfinance#Accounts")).rejects.toThrow();
  });

  it("a reader at the table's level reads the namespaced table", async () => {
    const { db, calls } = fakeDb({
      dataRows: [{ id: 1, name: "Savings", type: "bank_savings", contact: "x", updated_at: "2026-06-06" }],
    });
    const { registry } = await registerSchemas(db, MYFINANCE_SCHEMAS);
    const reader = createSharedDb({ db, appId: "myhealth", grantedLevel: "Confidential", registry });
    await reader.read("myfinance#Accounts");
    expect(calls.select.at(-1)!).toMatch(/FROM "myfinance_accounts"/);
  });

  it("only myFinance may write its own table", async () => {
    const { db } = fakeDb();
    const { registry } = await registerSchemas(db, MYFINANCE_SCHEMAS);
    const intruder = createSharedDb({ db, appId: "myhealth", grantedLevel: "Confidential", registry });
    await expect(intruder.write("myfinance#Accounts", { id: "x" })).rejects.toThrow(/may not write/);
  });
});
