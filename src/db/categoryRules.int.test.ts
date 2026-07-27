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

import { upsertCategoryRule, getCategoryRuleMap, listCategoryRules, deleteCategoryRule } from "./categoryRules";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("categoryRules", () => {
  it("upsertCategoryRule inserts a new (pattern, category) pair with hit_count 1", async () => {
    await upsertCategoryRule("UPI-SWIGGY-111111", "dining_food_delivery");
    const rules = await listCategoryRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe("upi-swiggy-#");
    expect(rules[0].category).toBe("dining_food_delivery");
    expect(rules[0].hit_count).toBe(1);
  });

  it("re-teaching the same (pattern, category) pair increments hit_count instead of duplicating", async () => {
    await upsertCategoryRule("UPI-SWIGGY-111111", "dining_food_delivery");
    await upsertCategoryRule("UPI-SWIGGY-222222", "dining_food_delivery");
    await upsertCategoryRule("UPI-SWIGGY-333333", "dining_food_delivery");
    const rules = await listCategoryRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].hit_count).toBe(3);
  });

  it("one pattern can teach multiple categories — a second category adds a second row, doesn't overwrite", async () => {
    await upsertCategoryRule("UPI-SWIGGY-111111", "dining_food_delivery");
    await upsertCategoryRule("UPI-SWIGGY-222222", "upi_payment");
    const rules = await listCategoryRules();
    expect(rules).toHaveLength(2);
    const map = await getCategoryRuleMap();
    expect(map.get("upi-swiggy-#")?.sort()).toEqual(["dining_food_delivery", "upi_payment"]);
  });

  it("no-ops for a blank/whitespace description", async () => {
    await upsertCategoryRule("   ", "groceries");
    expect(await listCategoryRules()).toHaveLength(0);
  });

  it("getCategoryRuleMap groups rows by pattern", async () => {
    await upsertCategoryRule("UPI-SWIGGY-111111", "dining_food_delivery");
    await upsertCategoryRule("UPI-BIGBASKET-111111", "groceries");
    const map = await getCategoryRuleMap();
    expect(map.get("upi-swiggy-#")).toEqual(["dining_food_delivery"]);
    expect(map.get("upi-bigbasket-#")).toEqual(["groceries"]);
  });

  it("listCategoryRules orders by hit_count desc", async () => {
    await upsertCategoryRule("A", "groceries");
    await upsertCategoryRule("B", "dining_food_delivery");
    await upsertCategoryRule("B", "dining_food_delivery");
    const rules = await listCategoryRules();
    expect(rules[0].pattern).toBe("b");
    expect(rules[0].hit_count).toBe(2);
  });

  it("deleteCategoryRule forgets a rule — it no longer appears in the map", async () => {
    await upsertCategoryRule("UPI-SWIGGY-111111", "dining_food_delivery");
    const [rule] = await listCategoryRules();
    await deleteCategoryRule(rule.id);
    expect(await listCategoryRules()).toHaveLength(0);
    expect((await getCategoryRuleMap()).size).toBe(0);
  });
});
