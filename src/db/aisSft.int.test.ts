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

import { upsertTaxYear } from "./tax";
import { replaceSftForAy, listSftForAy, listAllSft } from "./aisSft";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("replaceSftForAy / listSftForAy / listAllSft", () => {
  it("writes rows for an AY and reads them back", async () => {
    await upsertTaxYear("AY2026-27");
    await replaceSftForAy("AY2026-27", [
      { sftCode: "SFT-005", description: "Cash deposit", reportingEntity: "HDFC Bank", amount: 100000, date: null },
      { sftCode: "SFT-018", description: "MF purchase", reportingEntity: "Zerodha", amount: 50000, date: null },
    ]);
    const rows = await listSftForAy("AY2026-27");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sft_code).sort()).toEqual(["SFT-005", "SFT-018"]);
  });

  it("re-importing the same AY replaces rather than appends", async () => {
    await upsertTaxYear("AY2026-27");
    await replaceSftForAy("AY2026-27", [{ sftCode: "SFT-005", description: "a", reportingEntity: null, amount: 100, date: null }]);
    await replaceSftForAy("AY2026-27", [{ sftCode: "SFT-005", description: "a", reportingEntity: null, amount: 100, date: null }]);
    expect(await listSftForAy("AY2026-27")).toHaveLength(1);
  });

  it("listAllSft spans every AY", async () => {
    await upsertTaxYear("AY2025-26");
    await upsertTaxYear("AY2026-27");
    await replaceSftForAy("AY2025-26", [{ sftCode: "SFT-005", description: "a", reportingEntity: null, amount: 100, date: null }]);
    await replaceSftForAy("AY2026-27", [{ sftCode: "SFT-018", description: "b", reportingEntity: null, amount: 200, date: null }]);
    expect(await listAllSft()).toHaveLength(2);
  });
});
