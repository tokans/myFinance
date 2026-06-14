import { create } from "zustand";
import { isTauri } from "@/lib/environment";
import { countAccounts, countAccountsWithEmergencyAction } from "@/db/accounts";
import { countGoals } from "@/db/goals";
import { countSnapshots, listMonths } from "@/db/snapshots";
import { listTaxYears } from "@/db/tax";
import { countDistinctLaunchDays } from "@/db/usage";
import {
  getPatronState,
  recordDonation,
  recordPartner,
  markDonationPending,
  type PatronState,
} from "@/lib/patron";
import { readPatronGrant, readPartnerGrant } from "@/lib/patronFile";
import { EMPTY_TIER_CONTEXT, resolveTier, type Tier, type TierContext } from "@/lib/gamification";

/**
 * Single owner of the live TierContext + patron state. Aggregates the
 * data-presence signals, usage stats and donation state so the Dashboard badge,
 * the Usage screen and the shell's Patron/Partner button all read one picture.
 *
 * The five "feature used" signals are the data-presence proxy for Expert's "use
 * every feature once" criterion — tune the set here if features change.
 */
const EMPTY_PATRON: PatronState = {
  isPatron: false,
  donationDate: null,
  partnerOfferActive: false,
  pending: false,
  isPartner: false,
};

interface TierState {
  ctx: TierContext;
  patron: PatronState;
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Record that the donation page was opened (drives "Restart after Donation"). */
  markOpenedDonation: () => Promise<void>;
  /** Re-scan Downloads for Patron/Partner grant files; true if any was applied. */
  scanForGrants: () => Promise<boolean>;
}

/** Local 'YYYY-MM-DD' — the day boundary that matters for the Partner window. */
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const useTierStore = create<TierState>((set, get) => ({
  ctx: EMPTY_TIER_CONTEXT,
  patron: EMPTY_PATRON,
  loaded: false,
  refresh: async () => {
    if (!isTauri()) {
      set({ ctx: EMPTY_TIER_CONTEXT, patron: EMPTY_PATRON, loaded: true });
      return;
    }
    try {
      const [accounts, snapshots, goals, emergency, taxYears, months, days, patron] =
        await Promise.all([
          countAccounts(),
          countSnapshots(),
          countGoals(),
          countAccountsWithEmergencyAction(),
          listTaxYears(),
          listMonths(),
          countDistinctLaunchDays(),
          getPatronState(localToday()),
        ]);
      const featureSignals = [
        accounts > 0,
        snapshots > 0,
        goals > 0,
        emergency > 0,
        taxYears.length > 0,
      ];
      set({
        ctx: {
          distinctDays: days,
          monthsOfData: months.length,
          allFeaturesUsed: featureSignals.every(Boolean),
          isPatron: patron.isPatron,
          isPartner: patron.isPartner,
        },
        patron,
        loaded: true,
      });
    } catch (e) {
      console.error("Failed to refresh tier state:", e);
      set({ loaded: true });
    }
  },
  markOpenedDonation: async () => {
    if (isTauri()) await markDonationPending();
    set({ patron: { ...get().patron, pending: !get().patron.isPatron } });
  },
  scanForGrants: async () => {
    const [patron, partner] = await Promise.all([readPatronGrant(), readPartnerGrant()]);
    if (!patron && !partner) return false;
    if (isTauri()) {
      if (patron) await recordDonation(patron.since);
      if (partner) await recordPartner(partner.since);
    }
    await get().refresh();
    return true;
  },
}));

/** Convenience selector: the resolved tier for the current context. */
export function selectTier(state: TierState): Tier {
  return resolveTier(state.ctx);
}
