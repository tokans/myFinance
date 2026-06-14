/**
 * Serialise the local database into a {@link Bundle} for transfer. Foreign keys
 * are rewritten to the parent's `sync_id` so the peer can remap them to its own
 * local ids. Pure over {@link SyncDb}; credential/blob reading is injected so the
 * builder stays testable without a vault.
 */
import {
  SPEC,
  PHYSICAL,
  physicalTable,
  type Bundle,
  type ParentTable,
  type Row,
  type SyncCredential,
} from "./spec";
import { T } from "@/db/tables";
import type { SyncDb } from "./merge";
// Compartment scoping reuses the core multiuser primitives (no new crypto): a row tagged
// `compartment = "private:<userId>"` reaches ONLY that user. Untagged/`"shared"` rows
// behave exactly as pre-K4, so this is inert for single-user.
import { rowsForRecipient } from "sharedcorelib/multiuser";

const PARENTS: ParentTable[] = ["vault_entries", "accounts", "people", "documents"];

export interface BuildOptions {
  deviceId: string;
  /** ISO timestamp; passed in because workflows/tests can't call Date.now() freely. */
  createdAt: string;
  /** Read a decrypted credential for a stronghold key (vault must be unlocked). */
  readCredential?: (strongholdKey: string) => Promise<SyncCredential | null>;
  /** Read decrypted bytes of a document blob by its local file name. */
  readBlob?: (fileName: string) => Promise<Uint8Array | null>;
  /**
   * ADDITIVE (K4): the member this OUTGOING bundle is for. When set, rows in another
   * member's `private:<userId>` compartment are NOT emitted (send-side enforcement); shared
   * + the recipient's own private rows still travel. Omit it (single-user) and every row
   * is emitted, exactly as pre-K4.
   */
  recipientUserId?: string;
}

function bytesToB64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return (globalThis as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } }).Buffer!
    .from(bytes)
    .toString("base64");
}

export async function buildBundle(db: SyncDb, opts: BuildOptions): Promise<Bundle> {
  // Local id → sync_id for each FK parent, so child FKs can be rewritten.
  const parentSync = {} as Record<ParentTable, Map<number, string>>;
  for (const p of PARENTS) {
    const rows = await db.select<{ id: number; sync_id: string }>(`SELECT id, sync_id FROM ${PHYSICAL[p]}`);
    parentSync[p] = new Map(rows.map((r) => [Number(r.id), String(r.sync_id)]));
  }

  const tables: Record<string, Row[]> = {};
  for (const spec of SPEC) {
    const where = spec.exportWhere ? ` WHERE ${spec.exportWhere}` : "";
    const raw = await db.select<Row>(`SELECT ${spec.columns.join(", ")} FROM ${physicalTable(spec.table)}${where}`);
    const fkByCol = new Map(spec.fks.map((f) => [f.col, f.parent] as const));
    // Compartment scoping (send side): when a recipient is named, drop rows in foreign
    // private compartments before they ever enter the bundle. Inert when the column/option
    // is absent — `rowsForRecipient` treats an untagged row as `shared`.
    const scoped = opts.recipientUserId ? rowsForRecipient(raw, opts.recipientUserId) : raw;
    tables[spec.table] = scoped.map((r) => {
      const row: Row = { ...r };
      for (const [col, parent] of fkByCol) {
        const v = row[col];
        row[col] = v == null ? null : parentSync[parent].get(Number(v)) ?? null;
      }
      return row;
    });
  }

  const tombstones = await db.select<{ table_name: string; key: string; deleted_at: string }>(
    `SELECT table_name, key, deleted_at FROM ${T.syncTombstones}`,
  );

  const credentials: Record<string, SyncCredential> = {};
  if (opts.readCredential) {
    for (const ve of tables.vault_entries ?? []) {
      const cred = await opts.readCredential(String(ve.stronghold_key));
      if (cred) credentials[String(ve.sync_id)] = cred;
    }
  }

  const blobs: Record<string, string> = {};
  if (opts.readBlob) {
    for (const d of tables.documents ?? []) {
      if (!d.file_name) continue;
      const bytes = await opts.readBlob(String(d.file_name));
      if (bytes) blobs[String(d.sync_id)] = bytesToB64(bytes);
    }
  }

  return {
    version: 1,
    device_id: opts.deviceId,
    created_at: opts.createdAt,
    tables,
    tombstones,
    credentials,
    blobs,
  };
}
