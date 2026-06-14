import { describe, it, expect, vi } from "vitest";
import {
  buildUserSwitch,
  financeMemberPolicy,
  FEATURE_CATEGORIES,
  membersFromPeople,
  activeMemberClass,
  PRIMARY_MEMBER_KEY,
  type FinanceMember,
} from "./multiuser";
import { SENSITIVE_FEATURE_CATEGORIES } from "sharedcorelib/multiuser";
import type { Person } from "sharedcorelib/entities";
import type { FeatureKey } from "./featureGate";

const ALL_FEATURES: FeatureKey[] = ["tax", "fire", "emergency", "sync"];

const owner: FinanceMember = { key: "self", label: "Me", memberClass: "owner" };
const adult: FinanceMember = { key: "spouse", label: "Spouse", memberClass: "adult" };

describe("multi-user user-switch gating (paid + >1 member)", () => {
  const baseMembers = [owner, adult];

  it("INVARIANT 3 — free single primary user: no entitlement, one member ⇒ no switcher", () => {
    // The free tier: exactly one primary user, no paid entitlement.
    const free = buildUserSwitch({
      entitled: false,
      members: [owner],
      current: "self",
      onSwitch: () => {},
    });
    expect(free).toBeUndefined();
  });

  it("entitled but still a single primary user ⇒ no switcher (additive, not just paid)", () => {
    const single = buildUserSwitch({
      entitled: true,
      members: [owner],
      current: "self",
      onSwitch: () => {},
    });
    expect(single).toBeUndefined();
  });

  it("multiple members but NOT entitled ⇒ no switcher (paid-gated)", () => {
    const unpaid = buildUserSwitch({
      entitled: false,
      members: baseMembers,
      current: "self",
      onSwitch: () => {},
    });
    expect(unpaid).toBeUndefined();
  });

  it("entitled AND >1 member ⇒ switcher prop with current + members + onSwitch", () => {
    const onSwitch = vi.fn();
    const sw = buildUserSwitch({ entitled: true, members: baseMembers, current: "self", onSwitch });
    expect(sw).toBeDefined();
    expect(sw!.current).toBe("self");
    expect(sw!.members.map((m) => m.key)).toEqual(["self", "spouse"]);
    expect(sw!.members[0].avatarText).toBe("M"); // first char, upper
    sw!.onSwitch("spouse");
    expect(onSwitch).toHaveBeenCalledWith("spouse");
  });
});

describe("person-linked FeatureGuard policy (member_class, feature)", () => {
  it("FEATURE_CATEGORIES tags the sensitive set with the core vocabulary", () => {
    const [FINANCE, CREDENTIALS, ESTATE] = SENSITIVE_FEATURE_CATEGORIES;
    expect(FEATURE_CATEGORIES.tax).toContain(FINANCE);
    expect(FEATURE_CATEGORIES.fire).toContain(FINANCE);
    expect(FEATURE_CATEGORIES.sync).toContain(FINANCE);
    expect(FEATURE_CATEGORIES.emergency).toEqual(expect.arrayContaining([ESTATE, CREDENTIALS]));
  });

  it("owner (single-user default) sees EVERY feature", () => {
    for (const f of ALL_FEATURES) {
      expect(financeMemberPolicy.isFeatureAllowed("owner", f, FEATURE_CATEGORIES[f])).toBe(true);
    }
  });

  it("an absent/null member class normalizes to owner ⇒ everything allowed (pre-K4 behavior)", () => {
    for (const f of ALL_FEATURES) {
      expect(financeMemberPolicy.isFeatureAllowed(null, f, FEATURE_CATEGORIES[f])).toBe(true);
      expect(financeMemberPolicy.isFeatureAllowed(undefined, f, FEATURE_CATEGORIES[f])).toBe(true);
    }
  });

  it("any adult (co-admin) sees EVERY feature", () => {
    for (const f of ALL_FEATURES) {
      expect(financeMemberPolicy.isFeatureAllowed("adult", f, FEATURE_CATEGORIES[f])).toBe(true);
    }
  });

  it("child_user is denied the sensitive finance/estate/credentials gates", () => {
    // Every myFinance gate is sensitive (finance or estate+credentials) → all hidden.
    for (const f of ALL_FEATURES) {
      expect(financeMemberPolicy.isFeatureAllowed("child_user", f, FEATURE_CATEGORIES[f])).toBe(false);
    }
  });

  it("managed_dependent is likewise denied the sensitive gates", () => {
    for (const f of ALL_FEATURES) {
      expect(
        financeMemberPolicy.isFeatureAllowed("managed_dependent", f, FEATURE_CATEGORIES[f]),
      ).toBe(false);
    }
  });

  it("a non-sensitive feature stays allowed even for a child (default-allow)", () => {
    expect(financeMemberPolicy.isFeatureAllowed("child_user", "dashboard", [])).toBe(true);
  });
});

describe("members from the person spine", () => {
  const people: Person[] = [
    { person_key: "spouse", display_name: "Spouse", member_class: "adult" },
    { person_key: "self", display_name: "Me", member_class: "owner" },
    { person_key: "kid", display_name: "Kid", member_class: "child_user" },
  ];

  it("maps person rows to members, keeps self first, defaults class to owner", () => {
    const untagged: Person[] = [{ person_key: "self", display_name: "Me" }];
    expect(membersFromPeople(untagged)[0].memberClass).toBe("owner");

    const members = membersFromPeople(people);
    expect(members[0].key).toBe(PRIMARY_MEMBER_KEY);
    expect(members.map((m) => m.memberClass)).toContain("child_user");
  });

  it("activeMemberClass falls back to owner for an unknown/single-user current", () => {
    expect(activeMemberClass([], "self")).toBe("owner");
    expect(activeMemberClass(membersFromPeople(people), "kid")).toBe("child_user");
  });
});
