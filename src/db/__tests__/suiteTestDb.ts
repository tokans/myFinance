/**
 * Shared test helper: build an in-memory suite DB with myFinance's canonical
 * namespaced tables via the REAL `ensureSuiteSchema` (descriptors + aux-SQL) — the
 * same path production uses — and return the raw `node:sqlite` handle so the
 * integration tests' `./client` mock can run statements against it.
 *
 * Using `ensureSuiteSchema` (not the retired migration files) means the fixtures
 * exercise the actual consolidated DDL: INTEGER AUTOINCREMENT keys, CHECKs, FK
 * cascades, the sync triggers and the `myfinance_*` table names the wrappers target.
 */
import { DatabaseSync } from "node:sqlite";
import type { SqlDb } from "sharedcorelib/db";
import { ensureSuiteSchema } from "../schemas";

/** Adapt a node:sqlite handle to the lib's SqlDb (boolean→0/1, objects→JSON). */
function adapt(raw: DatabaseSync): SqlDb {
  const toParam = (v: unknown) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return v;
    if (v instanceof Uint8Array) return v;
    return JSON.stringify(v);
  };
  return {
    select: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      raw.prepare(sql).all(...params.map(toParam)) as T[],
    execute: async (sql: string, params: unknown[] = []) => {
      if (params.length === 0) { raw.exec(sql); return {}; }
      const r = raw.prepare(sql).run(...params.map(toParam));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
  };
}

/** A fresh in-memory suite DB with all myFinance + common tables created. */
export async function buildSuiteTestDb(): Promise<DatabaseSync> {
  const raw = new DatabaseSync(":memory:");
  // foreign_keys ON to exercise FK cascades; recursive_triggers stays OFF to match the
  // Tauri SQL plugin default — the 0021 touch triggers rely on it (a recursive fire within
  // the same datetime('now') second would otherwise see NEW.updated_at == OLD.updated_at).
  raw.exec("PRAGMA foreign_keys = ON;");
  await ensureSuiteSchema(adapt(raw));
  return raw;
}
