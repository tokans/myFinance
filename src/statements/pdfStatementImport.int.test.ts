import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildSuiteTestDb } from "@/db/__tests__/suiteTestDb";
import type { StatementPreview } from "./types";

// Shared in-memory DB handle the mocked client delegates to. `vi.hoisted` makes
// it visible inside the (hoisted) vi.mock factory below.
const h = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

// Replace the Tauri SQL client with one backed by node:sqlite so commitPdfStatement's
// real DB calls (commitImport's account/snapshot writes, replaceTransactionsForSource's
// transaction writes) run against a real suite DB built from the actual descriptors + aux-SQL.
vi.mock("@/db/client", async () => {
  const { T: tables } = await import("@/db/tables");
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

import { commitPdfStatement } from "./pdfStatementImport";
import { countTransactionsForAccount, listTransactionsForAccount } from "@/db/transactions";
import { listAccounts } from "@/db/accounts";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

function preview(overrides: Partial<StatementPreview> = {}): StatementPreview {
  return {
    accountName: "HDFC Savings",
    matchedAccountId: null,
    sourceFile: "jan-statement.pdf",
    transactions: [
      { date: "2026-01-05", rawDate: "05/01/2026", description: "Salary credit", debit: null, credit: 50000, balance: 50000 },
      { date: "2026-01-20", rawDate: "20/01/2026", description: "ATM withdrawal", debit: 2000, credit: null, balance: 48000 },
    ],
    monthlyBalances: [{ month: "2026-01", balance: 48000, asOfDate: "2026-01-20" }],
    warnings: [],
    passwordUsed: null,
    log: [],
    model: { source: { filename: "s.pdf", kind: "pdf", pages: 1 }, children: [], warnings: [] },
    ...overrides,
  };
}

describe("commitPdfStatement — transaction persistence", () => {
  it("creates the account (via commitImport) and writes one transaction row per parsed row", async () => {
    const result = await commitPdfStatement(preview(), { defaultCurrency: "INR" });
    expect(result.accountsCreated).toBe(1);
    expect(result.transactionsWritten).toBe(2);

const accounts = await listAccounts();
    expect(accounts).toHaveLength(1);
    const rows = await listTransactionsForAccount(accounts[0].id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.description).sort()).toEqual(["ATM withdrawal", "Salary credit"]);
  });

  it("re-committing the identical preview for the same account+file doesn't duplicate rows", async () => {
    await commitPdfStatement(preview(), { defaultCurrency: "INR" });
const accId = (await listAccounts())[0].id;
    expect(await countTransactionsForAccount(accId)).toBe(2);

    await commitPdfStatement(preview(), { defaultCurrency: "INR" });
    expect(await countTransactionsForAccount(accId)).toBe(2);
  });

  it("a different sourceFile for the same account adds a distinct batch", async () => {
    await commitPdfStatement(preview(), { defaultCurrency: "INR" });
const accId = (await listAccounts())[0].id;

    await commitPdfStatement(preview({ sourceFile: "jan-statement-corrected.pdf" }), { defaultCurrency: "INR" });
    expect(await countTransactionsForAccount(accId)).toBe(4);
  });

  it("writes nothing to the ledger when the statement had no recognized transaction rows", async () => {
    const result = await commitPdfStatement(preview({ transactions: [], monthlyBalances: [] }), { defaultCurrency: "INR" });
    expect(result.transactionsWritten).toBe(0);
  });
});
