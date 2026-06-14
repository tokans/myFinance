import { useEffect, useState, type ReactNode } from "react";
import { LockedFeature } from "./LockedFeature";
import { RetirementGoalDialog } from "@/components/goals/RetirementGoalDialog";
import { FEATURE_GATES, type FeatureKey } from "@/lib/featureGate";
import { useGatingStore } from "@/stores/gating.store";
import { useMemberStore, selectActiveMemberClass } from "@/stores/member.store";
import { financeMemberPolicy, FEATURE_CATEGORIES } from "@/lib/multiuser";

/**
 * Wraps a progressively-unlocked page. Re-checks the unlock prerequisite on
 * mount (so navigating in after meeting it shows the real page), and renders the
 * locked state otherwise.
 *
 * FIRE unlocks in place: its CTA opens the Healthy Retirement goal popup right
 * here rather than sending the user to the Goals page. Adding the goal refreshes
 * gating, which flips `unlocked` true and reveals the real page automatically.
 *
 * Person-linked (K4): the active member's class is consulted FIRST via the
 * `(member_class, feature)` soft policy — the sensitive finance/estate/credentials gates
 * are hidden from `child_user` / `managed_dependent`. UI-soft only (decision 19); the
 * crypto-hard boundary is the sync private compartment. Single-user = `owner` ⇒ inert.
 */
export function FeatureGuard({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const gate = FEATURE_GATES[feature];
  const loaded = useGatingStore((s) => s.loaded);
  const refresh = useGatingStore((s) => s.refresh);
  const unlocked = useGatingStore((s) => gate.isUnlocked(s));
  const memberClass = useMemberStore(selectActiveMemberClass);
  const [addGoalOpen, setAddGoalOpen] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);

  // Avoid flashing the locked screen before the first gating load resolves.
  if (!loaded) return null;

  // Member-class soft gate FIRST: a denied sensitive feature is hidden for the active
  // child member even if the reveal/tier flags would unlock it. `owner`/any adult ⇒ allowed.
  const memberAllowed = financeMemberPolicy.isFeatureAllowed(
    memberClass,
    feature,
    FEATURE_CATEGORIES[feature],
  );
  if (!memberAllowed) return <LockedFeature gate={gate} />;

  if (unlocked) return <>{children}</>;

  if (feature === "fire") {
    return (
      <>
        <LockedFeature gate={gate} onCtaClick={() => setAddGoalOpen(true)} />
        <RetirementGoalDialog open={addGoalOpen} onOpenChange={setAddGoalOpen} />
      </>
    );
  }

  return <LockedFeature gate={gate} />;
}
