import { describe, it, expect } from "vitest";
import { buildRegisterSnapshot } from "./registerSnapshot";
import {
  createFinanceBreakGlassContributor,
  buildFinanceSnapshot,
  sealRecipientSlice,
  openRecipientSlice,
  isBreakGlassReleaseEligible,
  tierLabelForAccessTier,
  MYFINANCE_BREAKGLASS_TIERS,
} from "./breakGlassContributor";

const snap = buildRegisterSnapshot({
  generatedOn: "2026-05-31",
  currency: "INR",
  accounts: [
    { name: "HDFC Savings", type: "bank_savings", institution: "HDFC", value: 500000, contact: "RM +91 99999", emergency_action: "Call RM" },
    { name: "ICICI FD", type: "fixed_deposit", institution: "ICICI", value: 200000 },
  ],
  people: [{ name: "Priya", relationship: "Spouse", phone: "+91 88888", email: "p@x.com" }],
  will: { executor: "Priya", location_of_original: "Locker", registered: true },
});

const contributor = createFinanceBreakGlassContributor(snap);

describe("createFinanceBreakGlassContributor", () => {
  it("declares one section per tier, each tagged with its minTier", async () => {
    const sections = await contributor.sections();
    expect(sections.map((s) => s.minTier).sort()).toEqual(["emergency", "full", "summary"]);
    expect(sections.every((s) => s.module === "myfinance")).toBe(true);
  });

  it("emergency section exposes only emergency-actionable accounts + phones", async () => {
    const snapshot = await buildFinanceSnapshot([contributor], "emergency");
    expect(snapshot.sections).toHaveLength(1); // only the tier-0 section is at/below 'emergency'
    const data = snapshot.sections[0].data as { accounts: unknown[]; people: { name: string; phone: string }[] };
    expect(data.accounts).toHaveLength(1); // only HDFC has emergency info
    expect(data.people[0]).toEqual({ name: "Priya", phone: "+91 88888" });
    // parity with the OLD path's tier-0 redaction (people = name + phone only). Full
    // byte-parity across all tiers is pinned in breakGlassParity.test.ts.
    expect(data.people).toEqual(snap.people.map((p) => ({ name: p.name, phone: p.phone ?? null })));
  });

  it("summary tier reveals structure but NOT values/contacts", async () => {
    const snapshot = await buildFinanceSnapshot([contributor], "summary");
    expect(snapshot.sections.map((s) => s.minTier)).toEqual(["emergency", "summary"]);
    const summary = snapshot.sections.find((s) => s.minTier === "summary")!;
    const json = JSON.stringify(summary.data);
    expect(json).not.toMatch(/500000|200000/); // no values leak
    expect(json).not.toMatch(/99999/); // no contact leaks
  });

  it("full tier reveals everything (values, will)", async () => {
    const snapshot = await buildFinanceSnapshot([contributor], "full");
    expect(snapshot.sections).toHaveLength(3); // all sections at/below 'full'
    const full = snapshot.sections.find((s) => s.minTier === "full")!;
    expect(JSON.stringify(full.data)).toMatch(/500000/);
    expect((full.data as { will: unknown }).will).toBeTruthy();
  });
});

describe("recipient slice (zero-knowledge round-trip)", () => {
  it("wraps a snapshot to opaque ciphertext and the FREE reader opens it with the passphrase only", async () => {
    const snapshot = await buildFinanceSnapshot([contributor], "full");
    const { blob, passphrase } = await sealRecipientSlice(snapshot);
    expect(blob).toBeInstanceOf(Uint8Array);
    // ciphertext must not contain plaintext financial data
    const asText = new TextDecoder().decode(blob);
    expect(asText).not.toMatch(/HDFC|Priya|500000/);

    const opened = await openRecipientSlice(blob, passphrase);
    expect(opened.tier).toBe("full");
    expect(opened.sections).toEqual(snapshot.sections); // exact round-trip
  });

  it("a wrong passphrase fails to open (no entitlement bypass)", async () => {
    const snapshot = await buildFinanceSnapshot([contributor], "emergency");
    const { blob } = await sealRecipientSlice(snapshot, "CORRECT-HORSE-BATTERY-STAPLE");
    await expect(openRecipientSlice(blob, "WRONG-PASSPHRASE-HERE-NOPE")).rejects.toThrow();
  });
});

describe("dead-man's-switch staleness (≥90d)", () => {
  it("is not eligible before the threshold or when never checked in", () => {
    expect(isBreakGlassReleaseEligible(null, "2026-06-10")).toBe(false);
    expect(isBreakGlassReleaseEligible("2026-05-01", "2026-06-10")).toBe(false); // ~40d
  });
  it("fires at/after 90 days of no check-in", () => {
    expect(isBreakGlassReleaseEligible("2026-01-01", "2026-06-10")).toBe(true); // >90d
    expect(isBreakGlassReleaseEligible("2026-03-12", "2026-06-10")).toBe(true); // exactly ~90d
  });
});

describe("tier mapping parity with estate access tiers", () => {
  it("maps 0/1/2 to emergency/summary/full", () => {
    expect(tierLabelForAccessTier(0)).toBe("emergency");
    expect(tierLabelForAccessTier(1)).toBe("summary");
    expect(tierLabelForAccessTier(2)).toBe("full");
    expect(MYFINANCE_BREAKGLASS_TIERS).toEqual(["emergency", "summary", "full"]);
  });
});
