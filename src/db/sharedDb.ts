import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/environment";
import {
  loadRegistry, createSharedDb,
  type SqlDb, type SharedDb,
} from "sharedcorelib/db";
import { createIceStore, type IceStore } from "sharedcorelib/ice";
import { createEntitiesStore } from "sharedcorelib/entities";
import { createBreakGlassLedger } from "sharedcorelib/breakglass";
import type { Confidentiality } from "sharedcorelib/schema";
import { ensureSuiteSchema } from "./schemas";
import { runLegacyConsolidation } from "./consolidate";

/**
 * Shared suite database wiring (sharedcorelib/db). After K1 consolidation the suite runs
 * ONE SQLite — `<shared core>/db/suite.db`, path from the `shared_core_db_path` Tauri
 * command — and it is the ONLY database: every myFinance table lives here, namespaced
 * `myfinance_*` (the per-app `myfinance.db` is migrated once and deleted; see ./consolidate.ts
 * and db/client.ts which now opens this same suite DB).
 *
 * On launch myFinance registers its schemas + aux-SQL into the shared registry (idempotent,
 * append-only) then runs the one-time legacy consolidation; cross-app reads/writes go through
 * a governed {@link SharedDb} handle.
 */
const APP_ID = "myfinance";

let dbPromise: Promise<Database> | null = null;

async function openSharedDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const path = await invoke<string>("shared_core_db_path");
      return Database.load(`sqlite:${path}`);
    })();
  }
  return dbPromise;
}

/**
 * Open the shared suite DB and return it adapted to the lib's injected `SqlDb` interface.
 * Used by the shared-entity / break-glass wiring (db/sharedEntities.ts) so those modules
 * don't each re-implement the Tauri-SQL→SqlDb bridge. Tauri-only (throws outside Tauri).
 */
export async function openSharedDbAdapter(): Promise<SqlDb> {
  return adapter(await openSharedDb());
}

/** Adapt the Tauri SQL plugin handle to the lib's injected `SqlDb` interface. */
function adapter(db: Database): SqlDb {
  return {
    select: <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      db.select<T[]>(sql, params),
    execute: async (sql: string, params: unknown[] = []) => {
      const r = await db.execute(sql, params);
      return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId ?? undefined };
    },
  };
}

/**
 * Register myFinance's schemas into the shared suite DB. Best-effort + idempotent —
 * call once on launch (inside Tauri). A schema conflict THROWS (caught here) so the
 * shared store is never corrupted; resolve it at build time via `publisher-ci`.
 */
export async function initSharedDb(): Promise<void> {
  if (!isTauri()) return;
  try {
    const sql = adapter(await openSharedDb());
    // Register descriptors + apply aux-SQL (canonical legacy tables + sync triggers).
    await ensureSuiteSchema(sql);
    // Ensure the shared common ICE card table exists even if myHealth hasn't run yet.
    await createIceStore(sql).ensure();
    // Ensure the shared-entity spine (person/event/document/asset) and the break-glass
    // grant ledger + audit tables exist — myFinance is the deepest entities consumer and
    // the first break-glass consumer, so it lays these down idempotently on launch.
    await createEntitiesStore(sql, { appId: APP_ID }).ensure();
    await createBreakGlassLedger(sql, { appId: APP_ID }).ensure();
    // One-time legacy myfinance.db → suite.db consolidation (decisions 6/24): copy +
    // verify + ledger + delete the legacy file. Idempotent; fail-silent (retries next boot).
    await runLegacyConsolidation(sql);
  } catch (e) {
    console.warn("shared-db init/consolidation skipped:", e);
  }
}

/**
 * Handle on the shared common ICE card table — the cross-app emergency card both
 * myFinance and myHealth read and edit. Returns null outside Tauri / if the shared DB
 * can't be opened, so callers degrade gracefully.
 */
export async function iceStore(): Promise<IceStore | null> {
  if (!isTauri()) return null;
  try {
    return createIceStore(adapter(await openSharedDb()));
  } catch (e) {
    console.warn("shared ICE store unavailable:", e);
    return null;
  }
}

/**
 * A governed handle on the shared suite DB at the caller's granted confidentiality:
 * reads expose only tables/fields at/below `grantedLevel`, writes only to owned tables.
 */
export async function sharedDbFor(grantedLevel: Confidentiality): Promise<SharedDb> {
  const sql = adapter(await openSharedDb());
  return createSharedDb({ db: sql, appId: APP_ID, grantedLevel, registry: await loadRegistry(sql) });
}
