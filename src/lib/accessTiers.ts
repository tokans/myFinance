import type { AccessTier } from "@/db/people";

/**
 * Progressive-access tiers (Feature 9). Pure metadata shared by the People form
 * and any view that surfaces a person's tier. The actual access enforcement /
 * export gating lands in Phase 9 — for now the tier is a recorded intent.
 */
export const ACCESS_TIERS: { value: AccessTier; label: string; hint: string }[] = [
  {
    value: 0,
    label: "Tier 0 — Emergency",
    hint: "Always visible: emergency contact, ICE card, hospitalisation file.",
  },
  {
    value: 1,
    label: "Tier 1 — Summary",
    hint: "While you're well: asset summary (no sensitive numbers), plus the Tier 0 emergency contacts.",
  },
  {
    value: 2,
    label: "Tier 2 — Full",
    hint: "Once triggered: full register, Will location, vault keys.",
  },
];

export function accessTierLabel(tier: number): string {
  return ACCESS_TIERS.find((t) => t.value === tier)?.label ?? `Tier ${tier}`;
}
