/**
 * The app marketplace ("More from this publisher"), bound to myFinance's adapters.
 *
 * The catalog MECHANISM — join the published-apps registry with this client's local
 * install/sync state, decide each row's action (open / download / enroll / current),
 * and gate Patron/Partner-only apps by entitlement — lives in the shared core
 * (`sharedcorelib/suite` → `createAppCatalog`). This file supplies the DI adapters:
 * the registry source, local-state persistence, OS opener, sibling launch, platform,
 * and the user's suite entitlements (read from the live patron/partner state).
 */
import { createAppCatalog } from "sharedcorelib/suite";
import { openExternal } from "@/lib/openExternal";
import { useTierStore } from "@/stores/tier.store";
import { SUITE_APP_ID } from "./config";
import { listPublishedApps } from "./registry";
import { getLocalState, setLocalState } from "./localState";
import { detectPlatform } from "./platform";

export const suiteCatalog = createAppCatalog({
  currentAppId: SUITE_APP_ID,
  listPublishedApps,
  getLocalState,
  setLocalState,
  openExternal,
  // Best-effort OS launch of an installed sibling via its URL scheme; falls back to
  // the marketing page. A first-class native launch is a documented next step.
  launchApp: async (app) => {
    try {
      await openExternal(`${app.appId}://open`);
    } catch {
      await openExternal(app.marketingUrl);
    }
  },
  platform: detectPlatform,
  // Suite entitlements come from the live grant/donation state (Patron/Partner).
  entitlements: async () => {
    const { patron } = useTierStore.getState();
    return { isPatron: patron.isPatron, isPartner: patron.isPartner };
  },
});
