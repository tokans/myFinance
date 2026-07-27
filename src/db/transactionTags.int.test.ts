import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
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

import { createAccount } from "./accounts";
import { insertTransaction } from "./transactions";
import { bulkAddTags, removeTag, listAllTags } from "./transactionTags";
import { getCategoryRuleMap } from "./categoryRules";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

async function makeTransaction(accountId: number, description = "UPI-SWIGGY-111111"): Promise<number> {
  return insertTransaction({
    account_id: accountId, date: "2026-01-05", raw_date: "05/01/2026", description,
    debit: 100, credit: null, balance: 900, source_path: "S",
  });
}

describe("transactionTags", () => {
  it("bulkAddTags is additive — a second category doesn't remove the first", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const id = await makeTransaction(a);
    await bulkAddTags([id], ["upi_payment"], "auto");
    await bulkAddTags([id], ["dining_food_delivery"], "manual");
    const tags = (await listAllTags()).filter((t) => t.transaction_id === id).map((t) => t.category).sort();
    expect(tags).toEqual(["dining_food_delivery", "upi_payment"]);
  });

  it("re-adding an existing tag upgrades its source (auto -> manual) instead of duplicating", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const id = await makeTransaction(a);
    await bulkAddTags([id], ["upi_payment"], "auto");
    await bulkAddTags([id], ["upi_payment"], "manual");
    const rows = (await listAllTags()).filter((t) => t.transaction_id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manual");
  });

  it("teaches category_rules only when source is manual", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const id = await makeTransaction(a);
    await bulkAddTags([id], ["upi_payment"], "auto");
    expect((await getCategoryRuleMap()).size).toBe(0);
    await bulkAddTags([id], ["dining_food_delivery"], "manual");
    expect((await getCategoryRuleMap()).get("upi-swiggy-#")).toEqual(["dining_food_delivery"]);
  });

  it("bulkAddTags applies every category to every id (cross product)", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const id1 = await makeTransaction(a, "x");
    const id2 = await makeTransaction(a, "y");
    await bulkAddTags([id1, id2], ["groceries", "upi_payment"], "manual");
    const byTxn = new Map<number, string[]>();
    for (const t of await listAllTags()) {
      const list = byTxn.get(t.transaction_id) ?? [];
      list.push(t.category);
      byTxn.set(t.transaction_id, list);
    }
    expect(byTxn.get(id1)?.sort()).toEqual(["groceries", "upi_payment"]);
    expect(byTxn.get(id2)?.sort()).toEqual(["groceries", "upi_payment"]);
  });

  it("is a no-op for an empty id or category list", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const id = await makeTransaction(a);
    await bulkAddTags([], ["groceries"], "manual");
    await bulkAddTags([id], [], "manual");
    expect(await listAllTags()).toHaveLength(0);
  });

  it("removeTag deletes one tag without touching category_rules (un-teaching is a separate, explicit action)", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const id = await makeTransaction(a);
    await bulkAddTags([id], ["upi_payment", "dining_food_delivery"], "manual");
    await removeTag(id, "upi_payment");
    const tags = (await listAllTags()).filter((t) => t.transaction_id === id).map((t) => t.category);
    expect(tags).toEqual(["dining_food_delivery"]);
    expect((await getCategoryRuleMap()).get("upi-swiggy-#")?.sort()).toEqual(["dining_food_delivery", "upi_payment"]);
  });
});
