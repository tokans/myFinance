import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { T } from "./tables";
import { buildSuiteTestDb } from "./__tests__/suiteTestDb";

// Shared in-memory DB handle the mocked client delegates to. `vi.hoisted` makes
// it visible inside the (hoisted) vi.mock factory below.
const h = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

// Replace the Tauri SQL client with one backed by node:sqlite so the REAL db
// layer runs against a real suite DB built from the actual descriptors + aux-SQL
// (the namespaced myfinance_* tables, including the new v3/v4 transactions steps).
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

import { createAccount, deleteAccount } from "./accounts";
import {
  insertTransaction, listTransactionsForAccount, listAllTransactions,
  replaceTransactionsForSource, deleteTransactionsForAccount, countTransactionsForAccount,
  confirmMatch, dismissMatch, deleteTransactionsByIds, deleteAllTransactions,
} from "./transactions";
import { bulkAddTags, listAllTags } from "./transactionTags";
import { upsertCategoryRule } from "./categoryRules";

beforeEach(async () => { h.db = await buildSuiteTestDb(); });

describe("migration creates the table/indexes/triggers", () => {
  it("round-trips a plain insert with sync_id/updated_at auto-backfilled", async () => {
    const accountId = await createAccount({ name: "Checking", type: "checking" });
    await insertTransaction({
      account_id: accountId, date: "2026-07-01", raw_date: "01/07/2026",
      description: "Salary credit", debit: null, credit: 50000, balance: 50000,
      source_path: "STATEMENT:jul.pdf",
    });
    const rows = await listTransactionsForAccount(accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("Salary credit");
    expect(rows[0].match_status).toBe("none");

    const raw = h.db!.prepare(`SELECT sync_id, updated_at FROM ${T.transactions} WHERE id = ?`).get(rows[0].id) as
      { sync_id: string | null; updated_at: string | null };
    expect(raw.sync_id).not.toBeNull();
    expect(raw.updated_at).not.toBeNull();
  });
});

describe("CRUD", () => {
  it("listAllTransactions filters unclassified / date range across accounts", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const b = await createAccount({ name: "B", type: "checking" });
    await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    const yId = await insertTransaction({ account_id: b, date: "2026-02-10", raw_date: "10/02/2026", description: "y", debit: null, credit: 200, balance: 200, source_path: "S" });
    await bulkAddTags([yId], ["salary_income"], "manual");

    expect(await listAllTransactions()).toHaveLength(2);
    expect(await listAllTransactions({ unclassifiedOnly: true })).toHaveLength(1);
    expect(await listAllTransactions({ fromDate: "2026-02-01" })).toHaveLength(1);
    expect(await listAllTransactions({ toDate: "2026-01-31" })).toHaveLength(1);
  });

  it("bulkAddTags writes tags with the given source, additively across ids", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const t1 = await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    const t2 = await insertTransaction({ account_id: a, date: "2026-01-06", raw_date: "06/01/2026", description: "y", debit: 50, credit: null, balance: 850, source_path: "S" });

    await bulkAddTags([t1], ["groceries"], "manual");
    await bulkAddTags([t2], ["groceries"], "auto");

    const tags = await listAllTags();
    expect(tags.find((tg) => tg.transaction_id === t1)!.source).toBe("manual");
    expect(tags.find((tg) => tg.transaction_id === t2)!.source).toBe("auto");
    expect(tags.every((tg) => tg.category === "groceries")).toBe(true);
  });

  it("confirmMatch links both sides symmetrically; dismissMatch marks both dismissed without linking", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const b = await createAccount({ name: "B", type: "checking" });
    await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "transfer out", debit: 500, credit: null, balance: 500, source_path: "S" });
    await insertTransaction({ account_id: b, date: "2026-01-06", raw_date: "06/01/2026", description: "transfer in", debit: null, credit: 500, balance: 500, source_path: "S" });
    const [t1] = await listTransactionsForAccount(a);
    const [t2] = await listTransactionsForAccount(b);

    await confirmMatch(t1.id, t2.id);
    const rows = await listAllTransactions();
    expect(rows.find((r) => r.id === t1.id)!.matched_transaction_id).toBe(t2.id);
    expect(rows.find((r) => r.id === t2.id)!.matched_transaction_id).toBe(t1.id);
    expect(rows.every((r) => r.match_status === "confirmed")).toBe(true);
  });

  it("dismissMatch marks both rows dismissed without setting a link", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    await insertTransaction({ account_id: a, date: "2026-01-06", raw_date: "06/01/2026", description: "y", debit: null, credit: 100, balance: 1000, source_path: "S" });
    const [t1, t2] = await listTransactionsForAccount(a);

    await dismissMatch(t1.id, t2.id);
    const rows = await listTransactionsForAccount(a);
    expect(rows.every((r) => r.match_status === "dismissed")).toBe(true);
    expect(rows.every((r) => r.matched_transaction_id === null)).toBe(true);
  });
});

describe("replaceTransactionsForSource — idempotent re-import", () => {
  it("re-importing the identical set for the same (account, sourcePath) doesn't duplicate rows", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const rows = [
      { date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900 },
      { date: "2026-01-06", raw_date: "06/01/2026", description: "y", debit: null, credit: 200, balance: 1100 },
    ];
    await replaceTransactionsForSource(a, "STATEMENT:jan.pdf", rows);
    await replaceTransactionsForSource(a, "STATEMENT:jan.pdf", rows);
    expect(await countTransactionsForAccount(a)).toBe(2);
  });

  it("a different sourcePath adds a distinct batch instead of deduping", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const row = { date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900 };
    await replaceTransactionsForSource(a, "STATEMENT:jan.pdf", [row]);
    await replaceTransactionsForSource(a, "STATEMENT:jan-corrected.pdf", [row]);
    expect(await countTransactionsForAccount(a)).toBe(2);
  });
});

describe("self-learning: rules survive deletion/re-import", () => {
  it("replaceTransactionsForSource auto-tags a row via the static heuristic on first import (every matching rule, not just one)", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    await replaceTransactionsForSource(a, "STATEMENT:jan.pdf", [
      { date: "2026-01-05", raw_date: "05/01/2026", description: "UPI-SWIGGY-111111", debit: 200, credit: null, balance: 800 },
    ]);
    const [row] = await listTransactionsForAccount(a);
    const tags = (await listAllTags()).filter((t) => t.transaction_id === row.id);
    expect(tags.map((t) => t.category).sort()).toEqual(["dining_food_delivery", "upi_payment"]);
    expect(tags.every((t) => t.source === "auto")).toBe(true);
  });

  it("a manually taught rule survives the transaction being deleted entirely, and auto-applies to a fresh similarly-worded row", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const id = await insertTransaction({
      account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "XYZCORP PAYMENT REF 55892",
      debit: null, credit: 50000, balance: 50000, source_path: "STATEMENT:jan.pdf",
    });
    await bulkAddTags([id], ["salary_income"], "manual");

    await deleteTransactionsByIds([id]);
    expect(await countTransactionsForAccount(a)).toBe(0);

    await replaceTransactionsForSource(a, "STATEMENT:feb.pdf", [
      { date: "2026-02-05", raw_date: "05/02/2026", description: "XYZCORP PAYMENT REF 99001", debit: null, credit: 50000, balance: 100000 },
    ]);
    const [row] = await listTransactionsForAccount(a);
    expect(row.id).not.toBe(id);
    const tags = (await listAllTags()).filter((t) => t.transaction_id === row.id);
    expect(tags.map((t) => t.category)).toEqual(["salary_income"]);
    expect(tags[0].source).toBe("auto");
  });

  it("re-importing the SAME sourcePath (a corrected re-upload) still applies a previously taught rule to the freshly-reinserted row", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const rowInput = { date: "2026-01-05", raw_date: "05/01/2026", description: "XYZCORP PAYMENT REF 55892", debit: null, credit: 50000, balance: 50000 };
    await replaceTransactionsForSource(a, "STATEMENT:jan.pdf", [rowInput]);
    const [firstRow] = await listTransactionsForAccount(a);
    await bulkAddTags([firstRow.id], ["salary_income"], "manual");

    // Re-uploading the same statement file deletes and reinserts (replaceTransactionsForSource's
    // own delete-by-(account_id, source_path) behavior) — the literal bug scenario this feature fixes.
    await replaceTransactionsForSource(a, "STATEMENT:jan.pdf", [rowInput]);
    const [secondRow] = await listTransactionsForAccount(a);

    expect(secondRow.id).not.toBe(firstRow.id);
    const tags = (await listAllTags()).filter((t) => t.transaction_id === secondRow.id);
    expect(tags.map((t) => t.category)).toEqual(["salary_income"]);
  });

  it("reclassifying a pattern with an additional category doesn't remove the earlier one — both apply on the next import", async () => {
    await upsertCategoryRule("XYZCORP PAYMENT REF 55892", "salary_income");
    await upsertCategoryRule("XYZCORP PAYMENT REF 12345", "reimbursement_income");
    const a = await createAccount({ name: "A", type: "checking" });
    await replaceTransactionsForSource(a, "STATEMENT:jan.pdf", [
      { date: "2026-01-05", raw_date: "05/01/2026", description: "XYZCORP PAYMENT REF 00000", debit: null, credit: 50000, balance: 50000 },
    ]);
    const [row] = await listTransactionsForAccount(a);
    const tags = (await listAllTags()).filter((t) => t.transaction_id === row.id).map((t) => t.category).sort();
    expect(tags).toEqual(["reimbursement_income", "salary_income"]);
  });
});

describe("deleteAccount cascades transactions", () => {
  it("removes transactions belonging to the deleted account only", async () => {
    const keep = await createAccount({ name: "Keep", type: "checking" });
    const drop = await createAccount({ name: "Drop", type: "checking" });
    await insertTransaction({ account_id: keep, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    await insertTransaction({ account_id: drop, date: "2026-01-06", raw_date: "06/01/2026", description: "y", debit: 50, credit: null, balance: 50, source_path: "S" });

    await deleteAccount(drop);

    expect(await countTransactionsForAccount(keep)).toBe(1);
    expect(await countTransactionsForAccount(drop)).toBe(0);
  });
});

describe("deleteTransactionsForAccount", () => {
  it("clears every transaction for one account", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    await deleteTransactionsForAccount(a);
    expect(await countTransactionsForAccount(a)).toBe(0);
  });
});

describe("deleteTransactionsByIds", () => {
  it("deletes only the given ids, leaving the rest untouched", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    await insertTransaction({ account_id: a, date: "2026-01-06", raw_date: "06/01/2026", description: "y", debit: 50, credit: null, balance: 850, source_path: "S" });
    const rows = await listTransactionsForAccount(a);

    await deleteTransactionsByIds([rows[0].id]);

    const remaining = await listTransactionsForAccount(a);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(rows[1].id);
  });

  it("is a no-op for an empty id list", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    await deleteTransactionsByIds([]);
    expect(await countTransactionsForAccount(a)).toBe(1);
  });
});

describe("deleteAllTransactions", () => {
  it("wipes the ledger across every account", async () => {
    const a = await createAccount({ name: "A", type: "checking" });
    const b = await createAccount({ name: "B", type: "checking" });
    await insertTransaction({ account_id: a, date: "2026-01-05", raw_date: "05/01/2026", description: "x", debit: 100, credit: null, balance: 900, source_path: "S" });
    await insertTransaction({ account_id: b, date: "2026-01-06", raw_date: "06/01/2026", description: "y", debit: 50, credit: null, balance: 50, source_path: "S" });

    await deleteAllTransactions();

    expect(await countTransactionsForAccount(a)).toBe(0);
    expect(await countTransactionsForAccount(b)).toBe(0);
  });
});
