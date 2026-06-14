/**
 * Break-glass — CORE-BACKED path (Stage C, Phase 3). myFinance is the FIRST consumer of
 * the core `sharedcorelib/breakglass` contributor interface (contracts/breakglass.md).
 *
 * ⚠ DO-NO-HARM: This is the NEW path, built BESIDE the existing shipping break-glass
 * (`domain/registerSnapshot.ts` `buildRegisterSnapshot` + `redactForTier`, and the
 * Tier-2 register export). The OLD path stays LIVE and is NOT touched. Cutting over to
 * this core path — and deleting the old register-snapshot redaction — is a DESTRUCTIVE
 * review item to be done only after the regression suite proves parity.
 *
 * What this module does that the old path didn't:
 *   - Implements the app-agnostic {@link BreakGlassContributor} interface so core can
 *     assemble + tier-filter myFinance sections alongside OTHER apps' contributors
 *     (myHealth next). The MODULE does its own redaction; core only filters by tier.
 *   - Reuses the existing tier-0/1/2 redaction semantics, re-expressed as per-section
 *     `minTier` so a recipient sees every section at or below their granted tier.
 *   - Wires the dead-man's-switch via core `isReleaseEligible` over myFinance's existing
 *     `isCheckinStale` (≥90d) staleness model.
 *   - Produces a zero-knowledge recipient slice (`wrapSlice`) opened by the FREE standalone
 *     reader (`openSlice`) with the out-of-band passphrase ONLY — no account/license.
 *
 * Pure where possible (DI clock); the wrap/open crypto delegates to core.
 */
import {
  buildSnapshot,
  wrapSlice,
  openSlice,
  generateRecipientPassphrase,
  isReleaseEligible,
  type BreakGlassContributor,
  type ContributorSection,
  type BreakGlassSnapshot,
  type BreakGlassTier,
} from "sharedcorelib/breakglass";
import type { RegisterSnapshot } from "./registerSnapshot";

/**
 * myFinance's break-glass tiers, ordered low→high. These mirror the existing estate
 * access tiers (0 emergency / 1 summary / 2 full register) as named tiers so the core
 * mechanism (which filters by `tierOrder.indexOf`) can rank them.
 */
export const MYFINANCE_BREAKGLASS_TIERS: BreakGlassTier[] = ["emergency", "summary", "full"];

/** Map the existing numeric estate access tier (0/1/2) to the named break-glass tier. */
export function tierLabelForAccessTier(tier: 0 | 1 | 2): BreakGlassTier {
  return MYFINANCE_BREAKGLASS_TIERS[tier];
}

const MODULE = "myfinance";

/**
 * Build myFinance's break-glass contributor from an already-assembled register snapshot
 * (the SAME `RegisterSnapshot` the old path produces via `gatherSnapshot`). Each disclosable
 * concern becomes a `ContributorSection` tagged with its `minTier`, carrying data ALREADY
 * redacted to be safe at that tier:
 *
 *   - `emergency` (tier 0): emergency-actionable accounts (contact / emergency_action) +
 *     people names & phones. Mirrors `redactForTier(.,0)`.
 *   - `summary` (tier 1): account structure (name/type/institution, NO values/contacts) +
 *     people name & relationship. Mirrors `redactForTier(.,1)`.
 *   - `full` (tier 2): full account values, all contacts, will details. Mirrors tier 2.
 *
 * The MODULE guarantees nothing above a section's `minTier` leaks into its `data`.
 */
export function createFinanceBreakGlassContributor(snapshot: RegisterSnapshot): BreakGlassContributor {
  const sections = (): ContributorSection[] => {
    const out: ContributorSection[] = [];

    // tier 0 — emergency-actionable only
    const emergencyAccounts = snapshot.accounts
      .filter((a) => a.emergency_action || a.contact)
      .map((a) => ({ name: a.name, type: a.type, contact: a.contact ?? null, emergency_action: a.emergency_action ?? null }));
    out.push({
      module: MODULE,
      minTier: "emergency",
      title: "Emergency actions & contacts",
      data: {
        currency: snapshot.currency,
        accounts: emergencyAccounts,
        people: snapshot.people.map((p) => ({ name: p.name, phone: p.phone ?? null })),
      },
    });

    // tier 1 — structure without sensitive numbers
    out.push({
      module: MODULE,
      minTier: "summary",
      title: "Asset register (structure)",
      data: {
        accounts: snapshot.accounts.map((a) => ({ name: a.name, type: a.type, institution: a.institution ?? null })),
        people: snapshot.people.map((p) => ({ name: p.name, relationship: p.relationship ?? null })),
      },
    });

    // tier 2 — full register: the raw snapshot concerns, passed through UNCHANGED so a
    // tier-2 recipient sees byte-identically what the legacy `redactForTier(.,2)` (the
    // identity projection) disclosed — no synthesised null contact/emergency_action keys.
    out.push({
      module: MODULE,
      minTier: "full",
      title: "Full financial register",
      data: {
        accounts: snapshot.accounts,
        people: snapshot.people,
        will: snapshot.will ?? null,
      },
    });

    return out;
  };

  return { module: MODULE, sections };
}

/**
 * Assemble a tier-redacted recipient snapshot from one or more contributors (myFinance now,
 * + myHealth later). Thin wrapper over core `buildSnapshot` pinned to myFinance's tier order.
 */
export function buildFinanceSnapshot(
  contributors: BreakGlassContributor[],
  recipientTier: BreakGlassTier,
  opts: { now?: string } = {},
): Promise<BreakGlassSnapshot> {
  return buildSnapshot(contributors, recipientTier, MYFINANCE_BREAKGLASS_TIERS, opts);
}

/**
 * Seal a recipient slice for hand-off out-of-band. Returns the ciphertext blob AND the
 * system-generated passphrase the user gives the recipient (the vendor never holds it).
 * If `passphrase` is omitted one is generated. Zero-knowledge: the blob is opaque.
 */
export async function sealRecipientSlice(
  snapshot: BreakGlassSnapshot,
  passphrase = generateRecipientPassphrase(),
): Promise<{ blob: Uint8Array; passphrase: string }> {
  const blob = await wrapSlice(snapshot, passphrase);
  return { blob, passphrase };
}

/**
 * FREE standalone reader: open a recipient slice with ONLY the passphrase — no account,
 * no license, no entitlement. Never gate this (safety floor stays free + login-less).
 */
export function openRecipientSlice(blob: Uint8Array, passphrase: string): Promise<BreakGlassSnapshot> {
  return openSlice(blob, passphrase);
}

/**
 * Dead-man's-switch eligibility wired to myFinance's existing staleness model. A release
 * becomes eligible after `thresholdDays` (default 90, matching `isCheckinStale`) of no
 * check-in. The user is notified first and can cancel ("I'm here") before any escalation;
 * this only computes eligibility — 2FA/escrow release is a registered-tier concern.
 */
export function isBreakGlassReleaseEligible(
  lastCheckin: string | null | undefined,
  nowIso: string,
  thresholdDays = 90,
): boolean {
  if (!lastCheckin) return false; // never checked in → not stale, just unset
  return isReleaseEligible({ thresholdDays }, lastCheckin, nowIso);
}
