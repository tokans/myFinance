/**
 * Per-app-private client-local state for the marketplace (installed / version /
 * phone-sync). Held in plain client storage — never uploaded (receive-only). The
 * current app is reported as installed at its running version by default; siblings
 * default to not-installed until the user installs them (OS-mediated).
 */
import type { AppLocalState } from "sharedcorelib/suite";
import { SUITE_APP_ID } from "./config";
import { currentAppVersion } from "./version";

const key = (appId: string) => `suite:local:${appId}`;

export async function getLocalState(appId: string): Promise<AppLocalState> {
  try {
    const raw = localStorage.getItem(key(appId));
    if (raw) return JSON.parse(raw) as AppLocalState;
  } catch {
    /* fall through to defaults */
  }
  if (appId === SUITE_APP_ID) {
    return { installed: true, installedVersion: await currentAppVersion(), phoneSyncEnabled: false };
  }
  return { installed: false, phoneSyncEnabled: false };
}

export async function setLocalState(appId: string, state: AppLocalState): Promise<void> {
  try {
    localStorage.setItem(key(appId), JSON.stringify(state));
  } catch {
    /* ignore — storage full / unavailable */
  }
}
