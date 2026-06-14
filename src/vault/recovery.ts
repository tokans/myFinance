/**
 * Recovery (Stage C, Phase 5 — SCAFFOLD) — adopts core `sharedcorelib/recovery`.
 *
 * Layered design (base-context v3; suite invariants):
 *   - **Free / local / login-less floor**: mint a recovery key (RK), wrap the master key
 *     under it, persist the ciphertext on-device. Recover the MK with the RK alone — no
 *     account, no backend. This is the safety floor; NEVER paywall it.
 *   - **Registered-tier escrow** (opt-in): push the SAME ciphertext blob to zero-knowledge
 *     escrow (the RK never leaves the device; the server stores only an undecryptable blob).
 *     Wired via an injected {@link EscrowClient}; absent on the free path.
 *   - **Premium social/Shamir**: `splitRecoveryKey`/`combineRecoveryKey` (core) — not wired
 *     into the UI here yet (future session).
 *
 * This module provides the local blob store (Tauri FS) + a factory; the crypto is core's.
 * Pure/DI so the free round-trip is unit-testable without Tauri.
 */
import { createRecovery, type Recovery, type RecoveryBlobStore, type EscrowClient } from "sharedcorelib/recovery";
import { isTauri } from "@/lib/environment";

const RECOVERY_BLOB_FILE = "recovery.blob";

/**
 * On-device store for the wrapped-master-key blob, next to the vault snapshot under
 * `$APPDATA/`. Free + offline. Tauri-only (the free recovery floor runs inside the app).
 */
export function tauriRecoveryBlobStore(): RecoveryBlobStore {
  return {
    save: async (blob) => {
      const { writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      await writeFile(RECOVERY_BLOB_FILE, blob, { baseDir: BaseDirectory.AppData });
    },
    load: async () => {
      const fs = await import("@tauri-apps/plugin-fs");
      try {
        if (!(await fs.exists(RECOVERY_BLOB_FILE, { baseDir: fs.BaseDirectory.AppData }))) return null;
        return await fs.readFile(RECOVERY_BLOB_FILE, { baseDir: fs.BaseDirectory.AppData });
      } catch {
        return null;
      }
    },
    clear: async () => {
      const fs = await import("@tauri-apps/plugin-fs");
      try {
        if (await fs.exists(RECOVERY_BLOB_FILE, { baseDir: fs.BaseDirectory.AppData })) {
          await fs.remove(RECOVERY_BLOB_FILE, { baseDir: fs.BaseDirectory.AppData });
        }
      } catch { /* already gone */ }
    },
  };
}

/**
 * Build the recovery handle. Pass an `escrow` client to enable the registered-tier ciphertext
 * backup; omit it for the free, offline, login-less floor. Inject `blobStore` in tests.
 */
export function buildRecovery(opts: { blobStore?: RecoveryBlobStore; escrow?: EscrowClient } = {}): Recovery {
  return createRecovery({
    blobStore: opts.blobStore ?? tauriRecoveryBlobStore(),
    escrow: opts.escrow, // free path leaves this undefined → no backend touched
  });
}

/** True only inside the app (the local recovery floor needs the FS). */
export const recoveryAvailable = (): boolean => isTauri();
