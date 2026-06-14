/**
 * Real-SQLite test fixture: adapts `node:sqlite` (in-process, in-memory) to the
 * lib's injected `SqlDb` interface, so schema/aux-trigger/migration tests run
 * against actual SQLite semantics (triggers, NOT NULL, CHECK, RAISE ABORT,
 * AUTOINCREMENT rowids) instead of a regex fake.
 */
import { DatabaseSync } from "node:sqlite";
import type { SqlDb } from "sharedcorelib/db";

export interface SqliteTestDb {
  db: SqlDb;
  raw: DatabaseSync;
  close: () => void;
}

type Param = string | number | bigint | null | Uint8Array;

const toParam = (v: unknown): Param => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return v;
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v);
};

export function openSqliteTestDb(): SqliteTestDb {
  const raw = new DatabaseSync(":memory:");
  // Match the Tauri SQL plugin default: FK cascades ON, recursive_triggers OFF.
  raw.exec("PRAGMA foreign_keys = ON;");
  const db: SqlDb = {
    select: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      raw.prepare(sql).all(...params.map(toParam)) as T[],
    execute: async (sql: string, params: unknown[] = []) => {
      if (params.length === 0) {
        raw.exec(sql);
        return {};
      }
      const r = raw.prepare(sql).run(...params.map(toParam));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
  };
  return { db, raw, close: () => raw.close() };
}
