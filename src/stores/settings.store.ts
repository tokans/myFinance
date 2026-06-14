import { create } from "zustand";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from "@/db/settings";
import { isTauri } from "@/lib/environment";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  hydrate: async () => {
    if (!isTauri()) {
      // Browser-only dev: skip DB, keep defaults.
      set({ loaded: true });
      return;
    }
    try {
      const settings = await loadSettings();
      set({ settings, loaded: true });
    } catch (e) {
      console.error("Failed to load settings:", e);
      set({ loaded: true });
    }
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    if (isTauri()) {
      try {
        await saveSettings(next);
      } catch (e) {
        console.error("Failed to save settings:", e);
      }
    }
  },
}));
