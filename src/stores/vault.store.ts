import { create } from "zustand";
import { isUnlocked, lock, resetVault as resetVaultFiles, unlock } from "@/vault/stronghold";
import { isTauri } from "@/lib/environment";
import { clearAllCredentialRefs } from "@/db/accounts";
import { clearAllDocuments } from "@/db/documents";

interface VaultState {
  unlocked: boolean;
  hasMasterPassword: boolean | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  unlockVault: (password: string) => Promise<void>;
  lockVault: () => Promise<void>;
  /**
   * "Forgot password" recovery: permanently deletes the master password,
   * every stored credential, and every uploaded document, then leaves the
   * vault as if freshly installed so the caller can set a new password.
   * Irreversible — there is no key escrow to recover the old data.
   */
  resetVault: () => Promise<void>;
}

/**
 * We treat "has master password" as "a stronghold snapshot file exists on disk".
 * The plugin doesn't expose a direct check, so we ask the FS plugin.
 */
async function snapshotExists(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    const { exists } = await import("@tauri-apps/plugin-fs");
    const dir = await appDataDir();
    const path = await join(dir, "vault.stronghold");
    return await exists(path);
  } catch {
    return false;
  }
}

export const useVaultStore = create<VaultState>((set) => ({
  unlocked: false,
  hasMasterPassword: null,
  loaded: false,
  hydrate: async () => {
    const exists = await snapshotExists();
    set({ hasMasterPassword: exists, unlocked: isUnlocked(), loaded: true });
  },
  unlockVault: async (password: string) => {
    await unlock(password);
    set({ unlocked: true, hasMasterPassword: true });
  },
  lockVault: async () => {
    await lock();
    set({ unlocked: false });
  },
  resetVault: async () => {
    // Best-effort: DB cleanup must not block wiping the actual secrets below,
    // and vice versa — a partial failure should still leave no dangling refs.
    await Promise.allSettled([clearAllCredentialRefs(), clearAllDocuments()]);
    await resetVaultFiles();
    set({ unlocked: false, hasMasterPassword: false });
  },
}));
