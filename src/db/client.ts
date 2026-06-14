import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/environment";

/**
 * The data-layer connection. After K1 consolidation (prompts/10, decisions 1/2/6) myFinance
 * has NO per-app database: every table lives in the ONE shared `suite.db`
 * (`<shared core>/db/suite.db`, path from the `shared_core_db_path` Tauri command),
 * namespaced `myfinance_*`. `getDb()` opens that suite DB; the `db/*.ts` wrappers address
 * the namespaced tables via the `T` map (re-exported here for convenience). The legacy
 * `myfinance.db` is migrated once and deleted on first boot (see ./consolidate.ts).
 *
 * The schema + aux-SQL are registered, and the one-time consolidation run, by
 * `initSharedDb()` (db/sharedDb.ts) on launch — this module only opens the handle.
 */
export { T } from "./tables";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!isTauri()) {
    throw new Error(
      "SQLite is only available inside Tauri. Run `npm run tauri:dev` instead of `npm run dev` to use the database.",
    );
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      const path = await invoke<string>("shared_core_db_path");
      return Database.load(`sqlite:${path}`);
    })();
  }
  return dbPromise;
}

export async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  const db = await getDb();
  await db.execute(sql, params);
}
