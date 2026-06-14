/**
 * Suite update manager wiring — the L2 background service that keeps the shared
 * runtime, reference data, registry and app versions current from the publisher's
 * signed feed.
 *
 * The verify flow (delegation chain → freshness → anti-rollback → verify-at-load →
 * apply) lives in the shared core (`sharedcorelib/suite` → `createSuiteUpdater`).
 * This file supplies myFinance's adapters: the network fetch, clock, daily lease,
 * installed-version lookups, the native-owned confirmation dialog, and the
 * apply/stage handlers. Best-effort and fail-silent — offline / bad signature /
 * stale / downgrade all leave existing data untouched. With placeholder keys
 * (see `config.ts`) signature checks fail closed, so nothing applies until the
 * real publisher keys + feed exist.
 */
import { createSuiteUpdater, type SuiteTarget, type UpdatePlan, type PublishedApp } from "sharedcorelib/suite";
import { query, T } from "@/db/client";
import { isTauri } from "@/lib/environment";
import { SUITE_TRUST_ANCHOR, SUITE_TRANSPORT_KEY_B64 } from "./config";
import { cachePublishedApps } from "./registry";
import { currentAppVersion } from "./version";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "suite:lastCheckedAt";
const ENABLED_KEY = "suite:updatesEnabled";
const SNAPSHOT_KEY = "suite:lastSnapshotVersion";
const RUNTIME_VERSION_KEY = "suite:runtimeVersion";
const PENDING_KEY = "suite:pendingNative";

const DEC = new TextDecoder();

function updatesEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Once-a-day throttle; doubles as the cross-process lease (best-effort, per device). */
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

/** Fetch a file (or its `.sig`) under the signed feed baseUrl. */
async function fetchFile(file: string): Promise<Uint8Array> {
  const { fetch } = await import("@tauri-apps/plugin-http");
  const base = SUITE_TRUST_ANCHOR.feed.baseUrl.replace(/\/+$/, "");
  const url = `${base}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Highest applied masters/partner revision — the installed "masters:common" version. */
async function mastersRevision(): Promise<string> {
  try {
    const rows = await query<{ v: number | null }>(
      `SELECT MAX(v) AS v FROM (
         SELECT MAX(version) AS v FROM ${T.masterOptions}
         UNION ALL
         SELECT MAX(version) AS v FROM ${T.partners}
       )`,
    );
    return String(rows[0]?.v ?? 0);
  } catch {
    return "0";
  }
}

function storedRuntimeVersion(): string {
  try {
    return localStorage.getItem(RUNTIME_VERSION_KEY) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Versions currently installed, keyed by target id (absent ⇒ not installed). */
async function getInstalledVersions(): Promise<Record<string, string>> {
  return {
    "app:myfinance": (await currentAppVersion()) ?? "0.0.0",
    "masters:common": await mastersRevision(),
    runtime: storedRuntimeVersion(),
  };
}

/**
 * Record a pending native/runtime target and stage its verified bytes to disk for
 * the native shell to apply on next launch. Disk staging is best-effort (wrapped so
 * a missing fs scope never aborts a check); the pending-version record always lands.
 */
async function stageToDisk(target: SuiteTarget, bytes: Uint8Array): Promise<void> {
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    // AppData ($APPDATA) — the scope granted in capabilities/default.json.
    const dir = "suite-staging";
    await fs.mkdir(dir, { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => undefined);
    await fs.writeFile(`${dir}/${target.id}`, bytes, { baseDir: fs.BaseDirectory.AppData });
  } catch (e) {
    console.warn("suite: staging to disk failed; recording pending version only", e);
  }
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}") as Record<string, string>;
    pending[target.id] = target.version;
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* ignore */
  }
}

/** Hot-apply a verified content target. Reference data stays on its dedicated track. */
async function applyContentUpdate(target: SuiteTarget, bytes: Uint8Array): Promise<void> {
  switch (target.kind) {
    case "registry": {
      // Refresh the marketplace registry live; open catalog views re-read on the event.
      try {
        const apps = JSON.parse(DEC.decode(bytes)) as PublishedApp[];
        cachePublishedApps(apps);
        window.dispatchEvent(new CustomEvent("suite:registry-updated"));
      } catch (e) {
        console.warn("suite: ignoring malformed registry payload", e);
      }
      return;
    }
    case "runtime":
      // The shared-runtime JS bundle is swapped in by the native bootstrap on next
      // launch; stage it and record the new version so the bootstrap picks it up.
      await stageToDisk(target, bytes);
      try {
        localStorage.setItem(RUNTIME_VERSION_KEY, target.version);
      } catch {
        /* ignore */
      }
      return;
    case "app-content":
      await stageToDisk(target, bytes);
      return;
    case "masters":
      // Reference data is owned by the dedicated masters OTA track (src/masters/updates.ts).
      return;
    default:
      await stageToDisk(target, bytes);
      return;
  }
}

/** Native targets (Rust shell / sidecars) — staged now, applied on next launch. */
async function stageNativeUpdate(target: SuiteTarget, bytes: Uint8Array): Promise<void> {
  await stageToDisk(target, bytes);
}

/** Native-owned confirmation gate — a real OS dialog, not webview UI. */
async function confirmUpdate(plan: UpdatePlan): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const n = plan.content.length + plan.native.length;
    return await ask(`${n} update${n === 1 ? "" : "s"} available for the Tokans suite. Download and apply now?`, {
      title: "Suite update",
      kind: "info",
      okLabel: "Update",
      cancelLabel: "Later",
    });
  } catch {
    return false;
  }
}

const updater = createSuiteUpdater({
  anchor: SUITE_TRUST_ANCHOR,
  transportKeyB64: SUITE_TRANSPORT_KEY_B64,
  fetchFile,
  now: () => new Date().toISOString(),
  getLastSnapshotVersion: async () => {
    try {
      return Number(localStorage.getItem(SNAPSHOT_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  },
  setLastSnapshotVersion: async (v) => {
    try {
      localStorage.setItem(SNAPSHOT_KEY, String(v));
    } catch {
      /* ignore */
    }
  },
  getInstalledVersions,
  confirmUpdate,
  applyContentUpdate,
  stageNativeUpdate,
  // Grant the daily lease at most once per day, and stamp the attempt on acquisition
  // so a failed/offline/unsigned check still backs off for a day instead of retrying
  // on every launch (the core only marks success otherwise).
  acquireLease: async () => {
    if (!dueForCheck()) return false;
    markChecked();
    return true;
  },
  markChecked,
});

/**
 * Run one suite update check. Returns true if anything was applied. Throttled to
 * once per day unless `force` is set; no-op in browser / when disabled.
 */
export async function runSuiteUpdateCheck(opts: { force?: boolean } = {}): Promise<boolean> {
  if (!isTauri() || !updatesEnabled()) return false;
  const res = await updater.check(opts);
  return res.applied;
}
