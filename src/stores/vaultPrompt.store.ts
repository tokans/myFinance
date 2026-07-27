import { create } from "zustand";
import { useVaultStore } from "@/stores/vault.store";

interface VaultPromptState {
  open: boolean;
  resolve: ((unlocked: boolean) => void) | null;
  /** Opens the unlock dialog, resolving true once the user unlocks, false if they cancel. */
  requestUnlock: () => Promise<boolean>;
  /** Called by the dialog once the user unlocks or dismisses it. */
  settle: (unlocked: boolean) => void;
}

const useVaultPromptStore = create<VaultPromptState>((set, get) => ({
  open: false,
  resolve: null,
  requestUnlock: () =>
    new Promise<boolean>((resolve) => {
      // A prompt already open just gets a second waiter — the dialog only
      // ever calls `settle` once, resolving every pending caller together.
      const prev = get().resolve;
      set({
        open: true,
        resolve: prev ? (unlocked) => { prev(unlocked); resolve(unlocked); } : resolve,
      });
    }),
  settle: (unlocked) => {
    const { resolve } = get();
    set({ open: false, resolve: null });
    resolve?.(unlocked);
  },
}));

export { useVaultPromptStore };

/**
 * Ensures the credential vault is unlocked before a caller reads/writes a
 * stored credential, prompting the user with a popup if it isn't rather than
 * failing outright — used by document-import flows so a locked vault doesn't
 * block parsing (see `documentPasswordVault.ts`). Resolves false (without
 * throwing) if the user cancels, letting the caller fall back gracefully.
 */
export async function ensureVaultUnlocked(): Promise<boolean> {
  if (useVaultStore.getState().unlocked) return true;
  return useVaultPromptStore.getState().requestUnlock();
}
