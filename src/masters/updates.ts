import { createOtaUpdater } from "sharedcorelib/masters";
import { query, T } from "@/db/client";
import { upsertMasterOptions } from "@/db/masterOptions";
import { upsertPartners } from "@/db/partners";
import {
  masterPayloadSchema,
  partnerPayloadSchema,
  manifestSchema,
  type MastersManifest,
} from "./updateSchema";
import { MASTERS_PUBKEY_HEX, MASTERS_TRANSPORT_KEY_B64 } from "./verify";

/**
 * Background data-update track: once a day, pull the signed master/partner bundle
 * from GitHub Releases, verify it, and hot-apply it to SQLite. The verify→decrypt
 * → throttle → fetch MECHANISM now lives in the shared core
 * (`sharedcorelib/masters` → `createOtaUpdater`); this file supplies myFinance's
 * adapters: the release URL, keys, manifest schema, how to read the applied
 * revision, and how to apply each entry to myFinance's own tables. No restart: on
 * success we dispatch `masters:updated` so open `useMaster` hooks re-load live.
 *
 * Everything here is best-effort and fail-silent. The app cannot send anything
 * out; this only pulls public reference data. See [[project_shared_core_extracted]].
 */

/** Rolling release that always holds the newest bundle. */
const BASE_URL = "https://github.com/tokans/myFinance/releases/download/masters-latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "masters:lastCheckedAt";
const ENABLED_KEY = "masters:updatesEnabled";

function updatesEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

function dueForCheck(): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
    return !Number.isFinite(last) || Date.now() - last >= CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markChecked(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Anti-downgrade floor, anchored to the data actually applied (max `version` across
 * the remote tables) — survives a localStorage clear, unlike a stored counter.
 */
async function appliedRevision(): Promise<number> {
  try {
    const rows = await query<{ v: number | null }>(
      `SELECT MAX(v) AS v FROM (
         SELECT MAX(version) AS v FROM ${T.masterOptions}
         UNION ALL
         SELECT MAX(version) AS v FROM ${T.partners}
       )`,
    );
    return rows[0]?.v ?? 0;
  } catch {
    return 0;
  }
}

async function currentAppVersion(): Promise<string | undefined> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return undefined; // unknown → skip the minAppVersion gate rather than block
  }
}

const updater = createOtaUpdater<MastersManifest>({
  baseUrl: BASE_URL,
  pubkeyHex: MASTERS_PUBKEY_HEX,
  transportKeyB64: MASTERS_TRANSPORT_KEY_B64,
  manifestSchema,
  getLastRevision: appliedRevision,
  getAppVersion: currentAppVersion,
  enabled: updatesEnabled,
  isDue: dueForCheck,
  markChecked,
  applyEntry: async (e) => {
    if (e.id === "partner") {
      await upsertPartners(partnerPayloadSchema.parse(e.payload), e.version);
    } else {
      await upsertMasterOptions(e.id, masterPayloadSchema.parse(e.payload), e.version);
    }
  },
  onApplied: (revision) => {
    window.dispatchEvent(new CustomEvent("masters:updated", { detail: { revision } }));
  },
});

/**
 * Run one update check. Returns true if any master/partner data was applied.
 * Throttled to once per day unless `force` is set.
 */
export function runMasterUpdateCheck(opts: { force?: boolean } = {}): Promise<boolean> {
  return updater.runUpdate(opts);
}
