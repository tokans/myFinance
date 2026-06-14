import { useCallback, useEffect, useState } from "react";
import type { MasterId, MasterOption } from "./types";
import { MASTERS, bakedOptionsFor } from "./registry";
import { addCustomOption, listCustomOptions } from "@/db/customOptions";
import { listMasterOptions } from "@/db/masterOptions";
// The merge + mode-pick MECHANISM now lives in the shared core. Re-exported here
// so existing `@/masters/store` import sites stay unchanged. The `useMaster` hook
// below (registry + DB coupled) is app-specific and stays. See [[project_shared_core_extracted]].
import {
  mergeMasterOptions,
  pickMode,
  DROPDOWN_MAX,
  loadCommonCities,
  type InputMode,
} from "sharedcorelib/masters";

// The common city seed is loaded lazily by the core (keeps the heavy JSON out of
// every consumer's eager bundle). `getCommonBaked("city")` returns [] until this
// resolves once. We prewarm it the first time any city picker mounts; the
// promise is memoised so concurrent pickers share one load.
let cityPrewarm: Promise<unknown> | null = null;
function prewarmCities(): Promise<unknown> {
  if (!cityPrewarm) cityPrewarm = loadCommonCities().catch(() => {});
  return cityPrewarm;
}

export { mergeMasterOptions, pickMode, DROPDOWN_MAX };
export type { InputMode };

const keyOf = (o: MasterOption) => o.value.trim().toLowerCase();

export interface UseMasterResult {
  options: MasterOption[];
  mode: InputMode;
  loading: boolean;
  /** Persist a user-typed "Other" value, merge it in, and return its canonical value. */
  addOption: (raw: string) => Promise<string | null>;
}

/**
 * Load + merge a master's options (baked ⊕ live API ⊕ user custom), reactive to
 * the resolved `parent` for dependent masters (e.g. city ← country code). Live
 * fetch is best-effort: failure/offline silently leaves the baked + custom set.
 */
export function useMaster(id: MasterId, parent: string | null = null): UseMasterResult {
  const def = MASTERS[id];
  const [baked] = useState(() => bakedOptionsFor(id, parent));
  const [options, setOptions] = useState<MasterOption[]>(baked);
  const [remote, setRemote] = useState<MasterOption[]>([]);
  const [, setCustom] = useState<MasterOption[]>([]);
  const [live, setLive] = useState<MasterOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Bumped when an over-the-air master update lands, so the list re-loads live
  // (no restart). See src/masters/updates.ts.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const onUpdated = () => setRefreshTick((t) => t + 1);
    window.addEventListener("masters:updated", onUpdated);
    return () => window.removeEventListener("masters:updated", onUpdated);
  }, []);

  // City baked options are lazily seeded by the core. When a city picker mounts,
  // prewarm the seed and bump the refresh tick once it lands so the baked
  // fallback (and the dropdown) repopulates without a manual reload.
  useEffect(() => {
    if (id !== "city") return;
    let cancelled = false;
    void prewarmCities().then(() => {
      if (!cancelled) setRefreshTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const bakedNow = bakedOptionsFor(id, parent);
    // Reset to baked immediately when the parent changes (e.g. country switched).
    setOptions(bakedNow);
    setLive(null);
    setRemote([]);
    setLoading(true);

    (async () => {
      const [remoteRows, customRows, liveRows] = await Promise.all([
        listMasterOptions(id, parent),
        listCustomOptions(id, parent).then((rows) =>
          rows.map<MasterOption>((r) => ({ value: r.value, label: r.label, source: "custom" })),
        ),
        def.live ? def.live(parent) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setRemote(remoteRows);
      setCustom(customRows);
      setLive(liveRows);
      setOptions(mergeMasterOptions(remoteRows, bakedNow, liveRows, customRows));
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id, parent, def, refreshTick]);

  const addOption = useCallback(
    async (raw: string): Promise<string | null> => {
      const value = raw.trim();
      if (!value) return null;
      await addCustomOption(id, value, value, parent);
      const next: MasterOption = { value, label: value, source: "custom" };
      setCustom((prev) => {
        const merged = prev.some((o) => keyOf(o) === keyOf(next)) ? prev : [...prev, next];
        setOptions(mergeMasterOptions(remote, bakedOptionsFor(id, parent), live, merged));
        return merged;
      });
      return value;
    },
    [id, parent, live, remote],
  );

  // Recompute mode from the live option set; custom additions can flip it.
  const mode = pickMode(options.length);
  return { options, mode, loading, addOption };
}
