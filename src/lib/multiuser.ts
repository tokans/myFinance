/**
 * Multi-user activation glue for myFinance (Stage K4).
 *
 * PURE, app-agnostic-ish logic for the paid multi-user surfaces, kept out of the
 * React components so it is unit-testable under the node vitest environment:
 *
 *   - {@link buildUserSwitch} — decides whether the SuiteShell user-switch affordance
 *     should mount at all (paid entitlement AND > 1 member). Returns the
 *     `SuiteUserSwitch` prop, or `undefined` for the free single-primary-user case so
 *     the shell renders PIXEL-IDENTICALLY to pre-K4 (invariant 3).
 *   - {@link financeMemberPolicy} — the `(member_class, feature)` UI-soft policy: the
 *     finance / estate / credentials sensitive set is hidden from `child_user`
 *     (decision 19). Any adult sees everything (co-admin).
 *   - {@link FEATURE_CATEGORIES} — maps each myFinance gate key to its sensitivity
 *     category tags so the FeatureGuard can pass them to the policy.
 *
 * UI-SOFT ONLY. Hiding a feature from a child is cosmetic; data a member must not be
 * able to READ lives in a crypto-hard private compartment (sync side, below). No new
 * crypto here — we reuse the core multiuser primitives.
 */
import {
  createChildSoftPolicy,
  SENSITIVE_FEATURE_CATEGORIES,
  type MemberClassPolicy,
} from "sharedcorelib/multiuser";
import { memberClassOf, type MemberClass, type Person } from "sharedcorelib/entities";
import type { SuiteUserSwitch, SuiteUserSwitchMember } from "sharedcorelib/ui";
import type { FeatureKey } from "./featureGate";

/** The canonical primary-user / "self" person key (matches the core gating PRIMARY_USER_KEY). */
export const PRIMARY_MEMBER_KEY = "self";

/**
 * Sensitivity category tags for each myFinance feature gate. myFinance's sensitive set is
 * **finance + estate + credentials** (decision 19) — tagged with the core
 * `SENSITIVE_FEATURE_CATEGORIES` vocabulary so the child-soft defaults hide them from
 * `child_user` / `managed_dependent`. Gates not listed carry no sensitivity tag (allowed
 * for everyone).
 */
const [FINANCE, CREDENTIALS, ESTATE] = SENSITIVE_FEATURE_CATEGORIES; // "finance" | "credentials" | "estate"

export const FEATURE_CATEGORIES: Record<FeatureKey, readonly string[]> = {
  // Tax tracking exposes income/holdings → finance.
  tax: [FINANCE],
  // FIRE projects net worth → finance.
  fire: [FINANCE],
  // Emergency/estate planning (nominees, will, access, credentials) → estate + credentials.
  emergency: [ESTATE, CREDENTIALS],
  // Device sync moves the whole financial dataset → finance.
  sync: [FINANCE],
};

/** The compiled child-soft policy: deny the sensitive categories to child_user/managed_dependent. */
export const financeMemberPolicy: MemberClassPolicy = createChildSoftPolicy();

/**
 * A myFinance "member" derived from the shared person spine: the stable person_key, a
 * label, and the effective member class (absent ⇒ owner).
 */
export interface FinanceMember {
  key: string;
  label: string;
  memberClass: MemberClass;
}

/** Project shared `person` rows onto the switchable member list (stable order, self first). */
export function membersFromPeople(people: Person[]): FinanceMember[] {
  const mapped = people.map((p) => ({
    key: p.person_key,
    label: p.display_name?.trim() || p.person_key,
    memberClass: memberClassOf(p),
  }));
  // Keep the primary user ("self") first; the rest in their incoming order.
  return mapped.sort((a, b) =>
    a.key === PRIMARY_MEMBER_KEY ? -1 : b.key === PRIMARY_MEMBER_KEY ? 1 : 0,
  );
}

/** The member class of the active member (defaults to owner when not found / single-user). */
export function activeMemberClass(members: FinanceMember[], currentKey: string): MemberClass {
  return members.find((m) => m.key === currentKey)?.memberClass ?? "owner";
}

export interface UserSwitchInputs {
  /** True only when the suite subscription / paid entitlement is active. */
  entitled: boolean;
  /** Members sourced from the person spine (via core member_class). */
  members: FinanceMember[];
  /** The active member's key. */
  current: string;
  onSwitch: (memberKey: string) => void;
}

/**
 * Build the SuiteShell `userSwitch` prop — or `undefined` to render nothing.
 *
 * Returns the prop ONLY when the paid entitlement is active AND there is more than one
 * member. (The shell ALSO enforces `members.length > 1`, so this is belt-and-braces; the
 * `entitled` gate is the part the shell can't know.) A free single-primary-user passes
 * `undefined` → the shell chrome is byte-identical to pre-K4.
 */
export function buildUserSwitch(inputs: UserSwitchInputs): SuiteUserSwitch | undefined {
  if (!inputs.entitled) return undefined;
  if (inputs.members.length <= 1) return undefined;
  const members: SuiteUserSwitchMember[] = inputs.members.map((m) => ({
    key: m.key,
    label: m.label,
    avatarText: m.label.charAt(0).toUpperCase() || undefined,
  }));
  return { current: inputs.current, members, onSwitch: inputs.onSwitch };
}
