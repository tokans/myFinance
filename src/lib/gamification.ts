import { Sprout, Compass, Award, Heart, Handshake, type LucideIcon } from "lucide-react";
import {
  resolveTier as resolveTierGeneric,
  tierReached,
  nextEarnedTiers as nextEarnedGeneric,
  standardTopTiers,
  hasPatronAccess,
  becomePatronVisible as becomePatronVisibleGeneric,
  type TierDef,
  type PatronPartnerCtx,
} from "sharedcorelib/tiers";

/**
 * Engagement tiers. The first three (Newcomer → Regular → Expert) are *earned*
 * through use; Patron and Partner are the SHARED standard top tiers — defined once
 * in `sharedcorelib/tiers` (`standardTopTiers`) and reused by every suite app, so
 * this file only declares the earned ladder and decorates the shared top tiers with
 * myFinance's icon/colour. Patron is *granted* on a donation; Partner is *activated*
 * by enrolling at the publisher portal. They also flip which call-to-action button
 * the shell shows (see components/feedback/DonateDialog.tsx).
 *
 * The resolution MECHANISM (highest-reached, expert-bar check, next-up list, the
 * standard top tiers, the "become a patron" CTA, patron-access check) all come from
 * the shared core. See [[project_shared_core_extracted]].
 *
 * Everything a tier can depend on is collected in TierContext so the predicates
 * stay pure and testable; the live values are assembled by stores/tier.store.ts.
 */
export interface TierContext extends PatronPartnerCtx {
  /** Distinct local calendar days the app has been opened. */
  distinctDays: number;
  /** Distinct months present in monthly_snapshot. */
  monthsOfData: number;
  /** True once every gated feature has data (see tier.store.ts). */
  allFeaturesUsed: boolean;
  /** Donation made — unlocks Patron directly, even straight from Regular. */
  isPatron: boolean;
  /** Activated by enrolling as a professional Partner. */
  isPartner: boolean;
}

export type TierKey = "newcomer" | "regular" | "expert" | "patron" | "partner";

/** App tier = the shared `TierDef` (key/label/criteria/reached/grant) + display fields. */
export interface Tier extends TierDef<TierContext> {
  key: TierKey;
  icon: LucideIcon;
  /** Tailwind text colour for the badge/icon. */
  className: string;
}

/** The earned (non-grant) tiers — myFinance's own progression. Listed low → high. */
const EARNED_TIERS: Tier[] = [
  {
    key: "newcomer",
    label: "Newcomer",
    icon: Sprout,
    className: "text-emerald-600 dark:text-emerald-400",
    criteria: "Just getting started.",
    reached: () => true,
  },
  {
    key: "regular",
    label: "Regular",
    icon: Compass,
    className: "text-sky-600 dark:text-sky-400",
    criteria: "Open the app on 7 distinct days, or record 3 months of data.",
    reached: (ctx) => ctx.distinctDays >= 7 && ctx.monthsOfData >= 3,
  },
  {
    key: "expert",
    label: "Expert",
    icon: Award,
    className: "text-violet-600 dark:text-violet-400",
    criteria: "Open the app on 20 distinct days and use every feature at least once.",
    reached: (ctx) => ctx.distinctDays >= 20 && ctx.allFeaturesUsed,
  },
];

/** myFinance's display fields for the shared standard top tiers. */
const TOP_DISPLAY: Record<"patron" | "partner", { icon: LucideIcon; className: string }> = {
  patron: { icon: Heart, className: "text-rose-600 dark:text-rose-400" },
  partner: { icon: Handshake, className: "text-amber-600 dark:text-amber-400" },
};

/**
 * Full ladder, low → high: the app's earned tiers, then the shared Patron/Partner
 * grant tiers. Resolution walks it HIGHEST-first, so Partner outranks Patron which
 * outranks Expert. (The shared Patron predicate is `isPatron || isPartner`, so a
 * Partner also clears the Patron bar.)
 */
export const TIERS: Tier[] = [
  ...EARNED_TIERS,
  ...standardTopTiers<TierContext>().map((t) => ({
    ...t,
    key: t.key as TierKey,
    ...TOP_DISPLAY[t.key as "patron" | "partner"],
  })),
];

const EMPTY_CONTEXT: TierContext = {
  distinctDays: 0,
  monthsOfData: 0,
  allFeaturesUsed: false,
  isPatron: false,
  isPartner: false,
};

/** The highest tier the given context qualifies for. */
export function resolveTier(ctx: TierContext): Tier {
  return resolveTierGeneric(TIERS, ctx);
}

/**
 * Whether the context clears the Expert tier bar. Tested against Expert's OWN
 * predicate (not the *resolved* tier) so a Patron/Partner who also meets the bar
 * still qualifies — Patron outranks Expert in resolveTier, but it shouldn't strip
 * Expert-gated features. Used to gate device sync.
 */
export function hasExpertAccess(ctx: TierContext): boolean {
  return tierReached(TIERS, "expert", ctx);
}

/**
 * Earned tiers the context has NOT yet reached, in ascending order. Patron and
 * Partner are excluded (they carry `grant: true`) — they are granted/activated,
 * not progressed toward, so the Usage screen lists them separately as opt-in
 * actions rather than "next up".
 */
export function nextEarnedTiers(ctx: TierContext): Tier[] {
  return nextEarnedGeneric(TIERS, ctx);
}

/** True once the context has Patron-level access (donated OR a Partner). */
export { hasPatronAccess };

/** Whether to show the "Become a Patron" CTA — after the 2nd earned tier, pre-Patron. */
export function becomePatronVisible(ctx: TierContext): boolean {
  return becomePatronVisibleGeneric(TIERS, ctx);
}

export { EMPTY_CONTEXT as EMPTY_TIER_CONTEXT };
