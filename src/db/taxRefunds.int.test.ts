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
import { replaceRefundsForAy, listRefundsForAy, listAllRefunds } from "./taxRefunds";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("replaceRefundsForAy / listRefundsForAy / listAllRefunds", () => {
  it("writes rows for an AY and reads them back", async () => {
    await upsertTaxYear("AY2026-27");
    await replaceRefundsForAy("AY2026-27", "AIS-PDF", [
      { amount: 15840, mode: "ECS", refundDate: "2025-11-19", sourcePath: "AIS-PDF", note: "ECS (direct credit to bank account)" },
    ]);
    const rows = await listRefundsForAy("AY2026-27");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 15840, mode: "ECS", refund_date: "2025-11-19" });
  });

  it("re-importing the same document replaces rather than appends", async () => {
    await upsertTaxYear("AY2026-27");
    await replaceRefundsForAy("AY2026-27", "AIS-PDF", [{ amount: 15840, mode: "ECS", refundDate: null, sourcePath: "AIS-PDF", note: null }]);
    await replaceRefundsForAy("AY2026-27", "AIS-PDF", [{ amount: 15840, mode: "ECS", refundDate: null, sourcePath: "AIS-PDF", note: null }]);
    expect(await listRefundsForAy("AY2026-27")).toHaveLength(1);
  });

  it("re-importing AIS doesn't clobber TIS's refund rows for the same AY (different producers)", async () => {
    await upsertTaxYear("AY2026-27");
    await replaceRefundsForAy("AY2026-27", "AIS-PDF", [{ amount: 15840, mode: "ECS", refundDate: null, sourcePath: "AIS-PDF", note: null }]);
    await replaceRefundsForAy("AY2026-27", "TIS-PDF", [{ amount: 5000, mode: null, refundDate: null, sourcePath: "TIS-PDF", note: null }]);
    // re-import AIS again — should only replace its own rows
    await replaceRefundsForAy("AY2026-27", "AIS-PDF", [{ amount: 16000, mode: "ECS", refundDate: null, sourcePath: "AIS-PDF", note: null }]);

    const rows = await listRefundsForAy("AY2026-27");
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([5000, 16000]);
  });

  it("listAllRefunds spans every AY", async () => {
    await upsertTaxYear("AY2025-26");
    await upsertTaxYear("AY2026-27");
    await replaceRefundsForAy("AY2025-26", "AIS-PDF", [{ amount: 100, mode: null, refundDate: null, sourcePath: "AIS-PDF", note: null }]);
    await replaceRefundsForAy("AY2026-27", "AIS-PDF", [{ amount: 200, mode: null, refundDate: null, sourcePath: "AIS-PDF", note: null }]);
    expect(await listAllRefunds()).toHaveLength(2);
  });
});
