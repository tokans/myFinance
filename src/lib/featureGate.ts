/**
 * Progressive feature unlocks. Some screens stay visible in the nav but render a
 * locked state until the user has done the prerequisite action. The predicates
 * read the gating store's flags (see stores/gating.store.ts); the copy here is
 * what the locked screen and the nav tooltip show.
 */
import type { GatingFlags } from "@/stores/gating.store";
import type { FeatureGate as FeatureGateGeneric } from "sharedcorelib/gating";

export type FeatureKey = "tax" | "fire" | "emergency" | "sync";

/** A myFinance feature gate = the shared gate framework type bound to our flags + keys. */
export type FeatureGate = FeatureGateGeneric<GatingFlags, FeatureKey>;

export const FEATURE_GATES: Record<FeatureKey, FeatureGate> = {
  tax: {
    key: "tax",
    isUnlocked: (g) => g.hasAccounts,
    lockedTitle: "Tax tracking is locked",
    unlockHint: "Add your first account to unlock tax tracking.",
    ctaLabel: "Add an account",
    ctaTo: "/accounts",
  },
  fire: {
    key: "fire",
    isUnlocked: (g) => g.hasRetirementGoal,
    lockedTitle: "FIRE planning is locked",
    unlockHint:
      "Add a Healthy Retirement goal to unlock FIRE planning — it refines that goal's target.",
    ctaLabel: "Add a Healthy Retirement goal",
    // Unlocks in place via a popup form — see FeatureGuard. No navigation.
  },
  emergency: {
    key: "emergency",
    isUnlocked: (g) => g.hasEmergencyAction,
    lockedTitle: "Emergency planning is locked",
    unlockHint:
      "Fill in the optional “Emergency action” on at least one account to unlock emergency planning.",
    ctaLabel: "Go to accounts",
    ctaTo: "/accounts",
  },
  sync: {
    key: "sync",
    isUnlocked: (g) => g.isExpert,
    lockedTitle: "Device sync is an Expert feature",
    unlockHint:
      "Reach the Expert tier — open the app on 20 distinct days and use every feature at least once — to sync your data across devices.",
    ctaLabel: "See your progress",
    ctaTo: "/usage",
  },
};
