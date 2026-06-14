import { createGatingStore } from "sharedcorelib/gating";
import { countAccounts, countAccountsWithEmergencyAction } from "@/db/accounts";
import { countGoals, countGoalsInCategory } from "@/db/goals";
import { countSnapshots } from "@/db/snapshots";
import { listTaxYears } from "@/db/tax";
import { countDistinctLaunchDays } from "@/db/usage";
import { hasExpertAccess, hasPatronAccess } from "@/lib/gamification";
import { getPatronState } from "@/lib/patron";
import { todayISO } from "@/lib/format";
import { HEALTHY_RETIREMENT_CATEGORY } from "@/domain/lifeGoals";

/**
 * The boolean prerequisites that progressive features gate on. The store pattern
 * (start locked, refresh, browser-unlocked fallback) now comes from the shared
 * core (`sharedcorelib/gating` → `createGatingStore`); this file supplies
 * myFinance's flag shape + the `computeFlags` adapter that queries its own DB.
 * See [[project_shared_core_extracted]].
 */
export interface GatingFlags {
  hasAccounts: boolean;
  /** True once the user has an active Healthy Retirement goal (gates FIRE). */
  hasRetirementGoal: boolean;
  hasEmergencyAction: boolean;
  /** True once the user clears the Expert tier bar (gates device sync). */
  isExpert: boolean;
}

// In browser/dev mode there is no DB to query, so treat everything as unlocked
// rather than blocking the preview behind a permanent locked screen.
const UNLOCKED_ALL: GatingFlags = {
  hasAccounts: true,
  hasRetirementGoal: true,
  hasEmergencyAction: true,
  isExpert: true,
};

export const useGatingStore = createGatingStore<GatingFlags>({
  initialFlags: {
    hasAccounts: false,
    hasRetirementGoal: false,
    hasEmergencyAction: false,
    isExpert: false,
  },
  unlockedAll: UNLOCKED_ALL,
  // A Patron/Partner gets instant access to all features — unlock everything without
  // consulting the per-feature prerequisites (mirrors `unlockedAll`).
  override: async () => {
    const s = await getPatronState(todayISO());
    return hasPatronAccess({ isPatron: s.isPatron, isPartner: s.isPartner });
  },
  computeFlags: async () => {
    const [accounts, retirementGoals, emergency, snapshots, goals, taxYears, days] =
      await Promise.all([
        countAccounts(),
        countGoalsInCategory(HEALTHY_RETIREMENT_CATEGORY),
        countAccountsWithEmergencyAction(),
        countSnapshots(),
        countGoals(),
        listTaxYears(),
        countDistinctLaunchDays(),
      ]);
    // Mirror tier.store's "every feature used once" signal set.
    const allFeaturesUsed =
      accounts > 0 && snapshots > 0 && goals > 0 && emergency > 0 && taxYears.length > 0;
    return {
      hasAccounts: accounts > 0,
      hasRetirementGoal: retirementGoals > 0,
      hasEmergencyAction: emergency > 0,
      isExpert: hasExpertAccess({
        distinctDays: days,
        monthsOfData: 0,
        allFeaturesUsed,
        isPatron: false,
        isPartner: false,
      }),
    };
  },
});
