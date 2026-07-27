/**
 * The app marketplace ("More from this publisher"), bound to myFinance's adapters.
 *
 * The catalog MECHANISM — join the published-apps registry with this client's local
 * install/sync state, decide each row's action (open / download / enroll / current),
 * and gate Patron/Partner-only apps by entitlement — lives in the shared core
 * (`sharedcorelib/suite` → `createSuiteCatalog`, which also folds in the byte-identical
 * platform / version / localState / registry glue). This file supplies only what genuinely
 * varies for myFinance: the app id, its baked seed, the OS opener and the live entitlements.
 */
import { createSuiteCatalog } from "sharedcorelib/suite";
import { openExternal } from "@/lib/openExternal";
import { useTierStore } from "@/stores/tier.store";
import { SUITE_APP_ID, SEED_PUBLISHED_APPS } from "./config";

export const suiteCatalog = createSuiteCatalog({
  appId: SUITE_APP_ID,
  seed: SEED_PUBLISHED_APPS,
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
  // Suite entitlements come from the live grant/donation state (Patron/Partner).
  entitlements: async () => {
    const { patron } = useTierStore.getState();
    return { isPatron: patron.isPatron, isPartner: patron.isPartner };
  },
});
