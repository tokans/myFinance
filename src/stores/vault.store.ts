import { create } from "zustand";
import { isUnlocked, lock, unlock } from "@/vault/stronghold";
import { isTauri } from "@/lib/environment";

interface VaultState {
  unlocked: boolean;
  hasMasterPassword: boolean | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  unlockVault: (password: string) => Promise<void>;
  lockVault: () => Promise<void>;
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
}));
