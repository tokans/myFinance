import { create } from "zustand";
import { isTauri } from "@/lib/environment";
import { entitiesStore } from "@/db/sharedEntities";
import {
  membersFromPeople,
  activeMemberClass,
  PRIMARY_MEMBER_KEY,
  type FinanceMember,
} from "@/lib/multiuser";
import type { MemberClass } from "sharedcorelib/entities";

/**
 * The active multi-user member + the switchable member list (sourced from the shared
 * person spine via core `member_class`). Single owner so the shell's user-switch
 * affordance and the FeatureGuard's member-class soft gate read one picture.
 *
 * Free single-primary-user: `members` resolves to ≤ 1 entry (just "self"), `current`
 * stays `"self"`, and the member class is `owner` — so every multi-user surface is inert
 * and the UX is pixel-identical to pre-K4 (invariant 3). The list only ever grows beyond
 * one when myLifeAssistant's family management has provisioned real members.
 */
interface MemberState {
  members: FinanceMember[];
  current: string;
  loaded: boolean;
  /** Re-read the member list from the person spine. */
  refresh: () => Promise<void>;
  /** Switch the active member (the switch target governs which view/FeatureGuard applies). */
  setCurrent: (memberKey: string) => void;
}

export const useMemberStore = create<MemberState>((set, get) => ({
  members: [],
  current: PRIMARY_MEMBER_KEY,
  loaded: false,
  refresh: async () => {
    if (!isTauri()) {
      set({ members: [], current: PRIMARY_MEMBER_KEY, loaded: true });
      return;
    }
    try {
      const store = await entitiesStore();
      const people = store ? await store.listPeople() : [];
      const members = membersFromPeople(people);
      // Keep a valid active member: if the current one vanished, fall back to self / first.
      const current = members.some((m) => m.key === get().current)
        ? get().current
        : members.find((m) => m.key === PRIMARY_MEMBER_KEY)?.key ??
          members[0]?.key ??
          PRIMARY_MEMBER_KEY;
      set({ members, current, loaded: true });
    } catch (e) {
      console.error("Failed to refresh members:", e);
      set({ loaded: true });
    }
  },
  setCurrent: (memberKey: string) => {
    if (memberKey === get().current) return;
    if (!get().members.some((m) => m.key === memberKey)) return;
    set({ current: memberKey });
  },
}));

/** Convenience selector: the active member's class (owner when single-user). */
export function selectActiveMemberClass(state: MemberState): MemberClass {
  return activeMemberClass(state.members, state.current);
}
