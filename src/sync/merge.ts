/**
 * Two-way, last-writer-wins merge of a remote {@link Bundle} into the local
 * database. Pure data logic over a tiny {@link SyncDb} interface so it can be
 * unit-tested against an in-memory SQLite (see merge.test.ts) exactly like
 * `buildMergeSql` in db/accounts.ts is.
 *
 * Conflict rule: a remote row replaces the local one only when its `updated_at`
 * is strictly newer; ties are broken by the higher `device_id`. Because both
 * devices apply the same rule to each other's bundle, they converge on the same
 * winner. Deletions ride along as tombstones: a remote tombstone removes a local
 * row unless the local row was edited after the deletion (edit-beats-delete).
 *
 * Foreign keys arrive as the parent's `sync_id` and are remapped to the local
 * autoincrement id via maps built as each parent table is applied (parents are
 * ordered before children in {@link SPEC}).
 */
import {
  SPEC,
  tombstoneKeyForRow,
  physicalTable,
  type Bundle,
  type ParentTable,
  type Row,
  type SyncCredential,
  type TableSpec,
} from "./spec";
import { T } from "@/db/tables";
// The LWW conflict rule + the SyncDb interface are the app-agnostic sync KERNEL,
// now in the shared core. The schema-bound merge engine below stays app-specific
// (myFinance's own SPEC/Bundle). See [[project_shared_core_extracted]].
import { isNewer, type SyncDb } from "sharedcorelib/sync";
// Compartment access uses the core multiuser primitives (no new crypto). A row tagged
// `private:<userId>` is skipped on ingest unless the local member is that user.
import { compartmentOf, canAccessCompartment } from "sharedcorelib/multiuser";

export type { SyncDb };

export interface MergeOptions {
  /** This device's id (settings.device_id) — the LWW tie-breaker. */
  localDeviceId: string;
  /** Store a credential into the local vault under `strongholdKey`. */
  onCredential?: (strongholdKey: string, cred: SyncCredential) => Promise<void>;
  /** Seal `bytes` into the local document store, returning the new local file name. */
  onBlob?: (bytes: Uint8Array, doc: Row) => Promise<string | null>;
  /**
   * ADDITIVE (K4): the LOCAL member's user id. When set, incoming rows in a compartment
   * this member can't access (another member's `private:<userId>`) are skipped on ingest.
   * Omit it (single-user) and every row is applied, exactly as pre-K4.
   */
  localUserId?: string;
}

export interface MergeSummary {
  added: number;
  updated: number;
  skipped: number;
  deleted: number;
}

interface Ctx extends MergeOptions {
  maps: Record<ParentTable, Map<string, number>>;
  summary: MergeSummary;
}

function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback (tests / tsx scripts).
  return new Uint8Array((globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer!.from(b64, "base64"));
}

/** Build a WHERE clause + params matching the local row for a (FK-resolved) row. */
function identityWhere(spec: TableSpec, row: Row): { where: string; params: unknown[] } {
  if (spec.identity.kind === "singleton") return { where: "id = 1", params: [] };
  if (spec.identity.kind === "uuid") return { where: "sync_id = ?", params: [row.sync_id] };
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const c of spec.identity.cols) {
    if (row[c] == null) {
      parts.push(`COALESCE(${c}, '') = ''`);
    } else {
      parts.push(`${c} = ?`);
      params.push(row[c]);
    }
  }
  return { where: parts.join(" AND "), params };
}

async function findLocal(db: SyncDb, spec: TableSpec, row: Row): Promise<Row | null> {
  const { where, params } = identityWhere(spec, row);
  const rows = await db.select<Row>(`SELECT * FROM ${physicalTable(spec.table)} WHERE ${where}`, params);
  return rows[0] ?? null;
}

function resolveFks(spec: TableSpec, raw: Row, ctx: Ctx): { row: Row; drop: boolean } {
  const row: Row = { ...raw };
  for (const fk of spec.fks) {
    const sync = row[fk.col];
    if (sync == null || sync === "") {
      row[fk.col] = null;
      continue;
    }
    const local = ctx.maps[fk.parent].get(String(sync));
    if (local == null) {
      if (fk.required) return { row, drop: true };
      row[fk.col] = null;
    } else {
      row[fk.col] = local;
    }
  }
  return { row, drop: false };
}

function norm(v: unknown): unknown {
  return v === undefined ? null : v;
}

async function insertRow(db: SyncDb, spec: TableSpec, row: Row, cols: string[]): Promise<number | string> {
  const singleton = spec.identity.kind === "singleton";
  const allCols = singleton ? ["id", ...cols] : cols;
  const values = singleton ? [1, ...cols.map((c) => norm(row[c]))] : cols.map((c) => norm(row[c]));
  const ph = allCols.map(() => "?").join(", ");
  const res = await db.execute(
    `INSERT INTO ${physicalTable(spec.table)} (${allCols.join(", ")}) VALUES (${ph})`,
    values,
  );
  if (singleton) return 1;
  if (spec.pk === "id") return Number(res.lastInsertId);
  return String(row[spec.pk]);
}

async function updateRow(db: SyncDb, spec: TableSpec, row: Row, cols: string[], pkValue: unknown): Promise<void> {
  const setCols = cols.filter((c) => c !== spec.pk);
  const set = setCols.map((c) => `${c} = ?`).join(", ");
  const params = [...setCols.map((c) => norm(row[c])), pkValue];
  await db.execute(`UPDATE ${physicalTable(spec.table)} SET ${set} WHERE ${spec.pk} = ?`, params);
}

async function getLocalTomb(db: SyncDb, table: string, key: string): Promise<string | null> {
  const rows = await db.select<{ deleted_at: string }>(
    `SELECT deleted_at FROM ${T.syncTombstones} WHERE table_name = ? AND key = ?`,
    [table, key],
  );
  return rows[0]?.deleted_at ?? null;
}

async function processTable(db: SyncDb, spec: TableSpec, bundle: Bundle, ctx: Ctx): Promise<void> {
  const rows = bundle.tables[spec.table] ?? [];
  for (const raw of rows) {
    // Compartment scoping (receive side): when this member is named, skip a row in a
    // private compartment they can't access. Untagged/shared rows always pass; inert
    // (no `localUserId`) for single-user.
    if (ctx.localUserId && !canAccessCompartment(compartmentOf(raw), ctx.localUserId)) {
      ctx.summary.skipped++;
      continue;
    }
    const { row, drop } = resolveFks(spec, raw, ctx);
    if (drop) {
      ctx.summary.skipped++;
      continue;
    }

    const cols = spec.columns.slice();
    const hasBlob = spec.table === "documents" && bundle.blobs[String(raw.sync_id)] != null;

    // Documents carry their (decrypted) blob in the bundle; re-seal it with THIS
    // device's key and point file_name at the new local file. Without a payload
    // we never reference a file that isn't here.
    if (spec.table === "documents") {
      if (hasBlob && ctx.onBlob) {
        const localFile = await ctx.onBlob(b64ToBytes(bundle.blobs[String(raw.sync_id)]), row);
        row.file_name = localFile;
        row.encrypted = localFile ? 1 : 0;
      } else {
        row.file_name = null;
        row.encrypted = 0;
      }
    }

    const local = await findLocal(db, spec, row);
    let localId: number | string;

    if (local) {
      if (isNewer(row.updated_at, local.updated_at, bundle.device_id, ctx.localDeviceId)) {
        // On a metadata-only update (no blob payload) keep the local file intact.
        const writeCols =
          spec.table === "documents" && !hasBlob
            ? cols.filter((c) => c !== "file_name" && c !== "encrypted")
            : cols;
        await updateRow(db, spec, row, writeCols, local[spec.pk]);
        ctx.summary.updated++;
      } else {
        ctx.summary.skipped++;
      }
      localId = (local.id as number) ?? (local[spec.pk] as number | string);
    } else {
      if (spec.identity.kind !== "singleton") {
        const tomb = await getLocalTomb(db, spec.table, tombstoneKeyForRow(spec, raw));
        if (tomb != null && !(String(row.updated_at) > tomb)) {
          ctx.summary.skipped++;
          continue;
        }
      }
      localId = await insertRow(db, spec, row, cols);
      ctx.summary.added++;
    }

    if (spec.table === "vault_entries" && ctx.onCredential) {
      const cred = bundle.credentials[String(raw.sync_id)];
      if (cred) await ctx.onCredential(String(row.stronghold_key), cred);
    }
    if (spec.isParent && raw.sync_id != null && localId != null) {
      ctx.maps[spec.isParent].set(String(raw.sync_id), Number(localId));
    }
  }
}

/** Translate a tombstone key back into the local row it targets, or null. */
async function findByTombstone(db: SyncDb, spec: TableSpec, key: string, ctx: Ctx): Promise<Row | null> {
  if (spec.identity.kind === "uuid") {
    const rows = await db.select<Row>(`SELECT * FROM ${physicalTable(spec.table)} WHERE sync_id = ?`, [key]);
    return rows[0] ?? null;
  }
  if (spec.identity.kind === "natural") {
    const parts = key.split("|");
    const fkByCol = new Map(spec.fks.map((f) => [f.col, f.parent]));
    const where: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < spec.identity.cols.length; i++) {
      const col = spec.identity.cols[i];
      const part = parts[i] ?? "";
      const parent = fkByCol.get(col);
      if (parent) {
        const localId = ctx.maps[parent].get(part);
        if (localId == null) return null; // parent unknown locally → no target
        where.push(`${col} = ?`);
        params.push(localId);
      } else if (part === "") {
        where.push(`COALESCE(${col}, '') = ''`);
      } else {
        where.push(`${col} = ?`);
        params.push(part);
      }
    }
    const rows = await db.select<Row>(`SELECT * FROM ${physicalTable(spec.table)} WHERE ${where.join(" AND ")}`, params);
    return rows[0] ?? null;
  }
  return null; // singletons aren't tombstoned
}

async function applyTombstones(db: SyncDb, bundle: Bundle, ctx: Ctx): Promise<void> {
  const specByTable = new Map(SPEC.map((s) => [s.table, s]));
  for (const t of bundle.tombstones) {
    const spec = specByTable.get(t.table_name);
    if (!spec) continue;
    // Remember the deletion locally (keep the newer timestamp on conflict).
    await db.execute(
      `INSERT INTO ${T.syncTombstones} (table_name, key, deleted_at) VALUES (?, ?, ?)
       ON CONFLICT(table_name, key) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
      [t.table_name, t.key, t.deleted_at],
    );
    const target = await findByTombstone(db, spec, t.key, ctx);
    // Delete unless the local row was edited AFTER the remote deletion.
    if (target && !(String(target.updated_at) > t.deleted_at)) {
      await db.execute(`DELETE FROM ${physicalTable(spec.table)} WHERE ${spec.pk} = ?`, [target[spec.pk]]);
      ctx.summary.deleted++;
    }
  }
}

/**
 * Apply a decrypted remote bundle into the local DB. Returns a per-operation
 * summary. The caller is responsible for transaction scope if desired; the
 * engine issues plain statements so it works under both the Tauri SQL plugin and
 * node:sqlite.
 */
export async function applyBundle(db: SyncDb, bundle: Bundle, opts: MergeOptions): Promise<MergeSummary> {
  const ctx: Ctx = {
    ...opts,
    maps: { vault_entries: new Map(), accounts: new Map(), people: new Map(), documents: new Map() },
    summary: { added: 0, updated: 0, skipped: 0, deleted: 0 },
  };
  for (const spec of SPEC) await processTable(db, spec, bundle, ctx);
  await applyTombstones(db, bundle, ctx);
  return ctx.summary;
}
