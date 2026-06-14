/**
 * Tauri-side wiring for device sync: turns the pure {@link buildBundle} /
 * {@link applyBundle} engine into "encrypt the local DB to bytes" and "merge
 * received bytes into the local DB", using the real SQLite connection, the
 * Stronghold vault, the document blob store, and the packageCrypto envelope.
 *
 * The 6-digit pairing code is the passphrase fed to encryptJson/decryptJson, so
 * the transfer is AES-256-GCM sealed end to end and a wrong code fails to
 * decrypt (GCM auth error) rather than producing garbage. Credentials and
 * document blobs are only included when the vault is unlocked.
 */
import { getDb, T } from "@/db/client";
import { isTauri } from "@/lib/environment";
import { encryptJson, decryptJson } from "@/lib/packageCrypto";
import { getCredential, putCredential, isUnlocked } from "@/vault/stronghold";
import { readBlob, saveBlob } from "@/vault/documentFiles";
import { buildBundle } from "./bundle";
import { applyBundle, type SyncDb, type MergeSummary } from "./merge";
import type { Bundle } from "./spec";

async function syncDb(): Promise<SyncDb> {
  const db = await getDb();
  return {
    select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.select<T[]>(sql, params);
    },
    async execute(sql: string, params: unknown[] = []) {
      const r = await db.execute(sql, params);
      return { lastInsertId: r.lastInsertId, rowsAffected: r.rowsAffected };
    },
  };
}

async function deviceId(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(`SELECT value FROM ${T.settings} WHERE key = 'device_id'`);
  return rows[0]?.value ?? "unknown-device";
}

/** Whether credentials + document blobs will be included in an export right now. */
export function canIncludeVault(): boolean {
  return isUnlocked();
}

/**
 * Build and encrypt the local database into a transferable byte array. Includes
 * credentials + document blobs only when the vault is unlocked.
 *
 * `recipientUserId` (K4, optional): the member this bundle is for — when set, another
 * member's private-compartment rows are excluded. Omitted for single-user (every row
 * travels, exactly as pre-K4).
 */
export async function exportEncryptedBundle(code: string, recipientUserId?: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error("Sync requires the desktop or mobile app.");
  const db = await syncDb();
  const withVault = isUnlocked();
  const bundle = await buildBundle(db, {
    deviceId: await deviceId(),
    createdAt: new Date().toISOString(),
    recipientUserId,
    readCredential: withVault
      ? async (key) => {
          const c = await getCredential(key);
          return c ? { label: c.label, username: c.username, password: c.password, notes: c.notes } : null;
        }
      : undefined,
    readBlob: withVault ? async (fileName) => readBlob(fileName).catch(() => null) : undefined,
  });
  return encryptJson(bundle, code);
}

export interface ImportResult extends MergeSummary {
  /** Counts of secrets the peer shipped that we could/couldn't store. */
  fromDevice: string;
}

/**
 * Decrypt a received byte array with the pairing code and merge it locally.
 * Throws a friendly error when the code is wrong (decryption fails).
 *
 * `localUserId` (K4, optional): the member receiving on this device — when set, incoming
 * rows in a private compartment this member can't access are skipped. Omitted for
 * single-user (every row applies, exactly as pre-K4).
 */
export async function importEncryptedBundle(
  cipher: Uint8Array,
  code: string,
  localUserId?: string,
): Promise<ImportResult> {
  if (!isTauri()) throw new Error("Sync requires the desktop or mobile app.");
  let bundle: Bundle;
  try {
    bundle = await decryptJson<Bundle>(cipher, code);
  } catch {
    throw new Error("Couldn't read the data — check that the code matches on both devices.");
  }
  if (bundle?.version !== 1) throw new Error("The other device sent an incompatible sync version.");

  const db = await syncDb();
  const withVault = isUnlocked();
  const summary = await applyBundle(db, bundle, {
    localDeviceId: await deviceId(),
    localUserId,
    onCredential: withVault ? (key, cred) => putCredential(key, cred) : undefined,
    onBlob: withVault ? async (bytes) => saveBlob(bytes) : undefined,
  });
  return { ...summary, fromDevice: bundle.device_id };
}
