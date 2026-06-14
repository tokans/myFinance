import { describe, expect, it } from "vitest";
import { buildBriefing } from "./familyPack";
import { buildRegisterSnapshot } from "./registerSnapshot";

const snap = buildRegisterSnapshot({
  generatedOn: "2026-05-31",
  currency: "INR",
  accounts: [
    { name: "HDFC Savings", type: "bank_savings", institution: "HDFC", value: 500000, emergency_action: "Call RM", contact: "RM +91 99999" },
  ],
  people: [{ name: "Priya", relationship: "Spouse", phone: "+91 88888" }],
  will: { executor: "Priya", location_of_original: "Bank locker", registered: true, probate_required: false },
});

describe("buildBriefing", () => {
  it("addresses the designated person and lists will, accounts, people", () => {
    const text = buildBriefing(snap, { designatedPerson: "Priya" });
    expect(text).toContain("for Priya");
    expect(text).toContain("Executor: Priya");
    expect(text).toContain("Original kept at: Bank locker");
    expect(text).toContain("HDFC Savings");
    expect(text).toContain("5,00,000"); // en-IN lakh grouping of 500000
    expect(text).toContain("Action: Call RM");
    expect(text.toLowerCase()).toContain("out of date");
  });

  it("redacts numbers when asked", () => {
    const text = buildBriefing(snap, { redactNumbers: true });
    expect(text).not.toContain("500,000");
    expect(text).toContain("[bank_savings]");
  });

  it("defaults the addressee when none given", () => {
    expect(buildBriefing(snap)).toContain("for my family");
  });
});
