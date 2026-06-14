/**
 * K1 break-glass cutover (#10) — PARITY EVIDENCE.
 *
 * The legacy `redactForTier` redaction was EXCLUSIVE per tier (a tier-N recipient got only
 * the tier-N projection). The core break-glass contributor path is CUMULATIVE BY DESIGN:
 * a recipient at tier T sees every section whose `minTier` ≤ T (so tier-1 ⊇ tier-0). This
 * is intentional — the tiers are nested by TRUST (emergency ≤ summary ≤ full), so a
 * summary-tier recipient, being more trusted than an emergency-tier one, also receives the
 * emergency contacts. (The on-device "Press during Emergency" overlay is a SEPARATE,
 * untiered surface — see EmergencyOverlay — and is unaffected.)
 *
 * Parity therefore holds PER SECTION, not as a single flat projection: each core section's
 * `data` is byte-identical to the legacy `redactForTier` projection for THAT section's tier,
 * and the cumulative disclosure at tier T is exactly the union of sections with minTier ≤ T.
 * That is what this test pins — including an explicit lock on the intended tier-1 superset
 * (it now carries tier-0 emergency contactability). An earlier version of this test projected
 * the cumulative output down to a single legacy shape and so silently hid the superset; that
 * masking is removed here.
 *
 * This file is kept as the regression evidence backing the destructive removal — do not
 * delete it when `redactForTier` goes away (it pins the cutover's equivalence forever).
 */
import { describe, it, expect } from "vitest";
import {
  buildRegisterSnapshot,
  type RegisterSnapshot,
} from "./registerSnapshot";
import {
  createFinanceBreakGlassContributor,
  buildFinanceSnapshot,
  tierLabelForAccessTier,
} from "./breakGlassContributor";
import type { BreakGlassTier } from "sharedcorelib/breakglass";

/**
 * FROZEN reference implementation of the retired `redactForTier` (verbatim from the
 * pre-#10 `domain/registerSnapshot.ts`). The cutover deleted the production function;
 * this local copy is the permanent oracle the core path is held byte-equivalent to.
 */
function redactForTier(snapshot: RegisterSnapshot, tier: 0 | 1 | 2): RegisterSnapshot {
  if (tier === 2) return snapshot;
  if (tier === 1) {
    return {
      ...snapshot,
      accounts: snapshot.accounts.map((a) => ({
        name: a.name, type: a.type, institution: a.institution ?? null,
      })),
      people: snapshot.people.map((p) => ({ name: p.name, relationship: p.relationship ?? null })),
    };
  }
  return {
    ...snapshot,
    accounts: snapshot.accounts
      .filter((a) => a.emergency_action || a.contact)
      .map((a) => ({ name: a.name, type: a.type, contact: a.contact ?? null, emergency_action: a.emergency_action ?? null })),
    people: snapshot.people.map((p) => ({ name: p.name, phone: p.phone ?? null })),
    will: null,
  };
}

/** A rich fixture: emergency-actionable + plain accounts, a person, a will. */
const snap: RegisterSnapshot = buildRegisterSnapshot({
  generatedOn: "2026-05-31",
  currency: "INR",
  accounts: [
    { name: "HDFC Savings", type: "bank_savings", institution: "HDFC", value: 500000, contact: "RM +91 99999", emergency_action: "Call RM" },
    { name: "ICICI FD", type: "fixed_deposit", institution: "ICICI", value: 200000 },
    { name: "Wallet Cash", type: "cash", institution: null, value: 3000, contact: "Spouse", emergency_action: "In the safe" },
  ],
  people: [
    { name: "Priya", relationship: "Spouse", phone: "+91 88888", email: "p@x.com" },
    { name: "Ravi", relationship: "Brother", phone: "+91 77777", email: null },
  ],
  will: { executor: "Priya", location_of_original: "Bank locker", registered: true, probate_required: false },
});

/** Canonical key-sorted JSON so field-ORDER never causes a spurious mismatch. */
function canon(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as object).sort()) o[k] = sort((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

/** The legacy redaction reduced to just the disclosed concern fields (drops version/app/meta). */
function legacyDisclosed(s: RegisterSnapshot, tier: 0 | 1 | 2): Partial<RegisterSnapshot> {
  const r = redactForTier(s, tier);
  if (tier === 0) return { currency: r.currency, accounts: r.accounts, people: r.people };
  if (tier === 1) return { accounts: r.accounts, people: r.people };
  return { accounts: r.accounts, people: r.people, will: r.will ?? null };
}

/** Each core section's `minTier` maps to the legacy numeric tier whose projection it must equal. */
const TIER_OF: Record<BreakGlassTier, 0 | 1 | 2> = { emergency: 0, summary: 1, full: 2 };
/** Cumulative: a recipient at tier T receives every section with minTier ≤ T. */
const EXPECTED_SECTIONS: Record<BreakGlassTier, BreakGlassTier[]> = {
  emergency: ["emergency"],
  summary: ["emergency", "summary"],
  full: ["emergency", "summary", "full"],
};

describe("break-glass cutover parity (#10): per-section parity, composed CUMULATIVELY", () => {
  const contributor = createFinanceBreakGlassContributor(snap);

  for (const tier of [0, 1, 2] as const) {
    const label = tierLabelForAccessTier(tier);
    it(`tier ${tier} (${label}) discloses the cumulative section set, each byte-identical to legacy`, async () => {
      const core = await buildFinanceSnapshot([contributor], label);
      // (a) the cumulative section set is exactly { minTier ≤ recipientTier }.
      expect(core.sections.map((s) => s.minTier)).toEqual(EXPECTED_SECTIONS[label]);
      // (b) every disclosed section's data byte-equals the frozen legacy projection for ITS tier.
      for (const section of core.sections) {
        const legacyTier = TIER_OF[section.minTier as BreakGlassTier];
        expect(canon(section.data)).toBe(canon(legacyDisclosed(snap, legacyTier)));
      }
    });
  }

  it("INTENDED superset: tier-1 (summary) ALSO carries tier-0 emergency contactability", async () => {
    // The cutover changed the model from exclusive to cumulative ON PURPOSE: a summary-tier
    // recipient is MORE trusted than an emergency-tier one, so they also receive emergency
    // contacts. Pin it so it can't silently regress (the old test masked this).
    const summary = await buildFinanceSnapshot([contributor], "summary");
    const emergency = summary.sections.find((s) => s.minTier === "emergency")!;
    const data = emergency.data as {
      accounts: { contact: string | null; emergency_action: string | null }[];
      people: { phone: string | null }[];
    };
    expect(data.people.some((p) => p.phone === "+91 88888")).toBe(true);
    expect(data.accounts.some((a) => a.contact === "RM +91 99999" || a.emergency_action === "Call RM")).toBe(true);
  });

  it("the core path never leaks a higher tier's fields into a LOWER-tier SECTION", async () => {
    // The emergency SECTION must not reveal account VALUES or institution structure …
    const emergency = await buildFinanceSnapshot([contributor], "emergency");
    expect(JSON.stringify(emergency.sections)).not.toMatch(/500000|200000|"institution"/);
    // … and the summary SECTION must not reveal values or contact strings (the emergency
    // contactability a summary recipient also sees lives in the SEPARATE emergency section).
    const summary = await buildFinanceSnapshot([contributor], "summary");
    expect(JSON.stringify(summary.sections.find((s) => s.minTier === "summary")!.data)).not.toMatch(/500000|99999|Call RM/);
  });

  it("emergency tier keeps ONLY accounts that carry an emergency action or contact", async () => {
    const core = await buildFinanceSnapshot([contributor], "emergency");
    const accts = (core.sections[0].data as { accounts: { name: string }[] }).accounts;
    expect(accts.map((a) => a.name).sort()).toEqual(["HDFC Savings", "Wallet Cash"]); // ICICI FD has neither → excluded
    // identical to the legacy filter
    expect(accts.map((a) => a.name).sort()).toEqual(redactForTier(snap, 0).accounts.map((a) => a.name).sort());
  });
});
