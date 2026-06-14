import { describe, expect, it } from "vitest";
import { buildRegisterSnapshot } from "./registerSnapshot";

const base = buildRegisterSnapshot({
  generatedOn: "2026-05-31",
  currency: "INR",
  accounts: [
    { name: "HDFC Savings", type: "bank_savings", institution: "HDFC", value: 500000, contact: "RM +91 99999", emergency_action: "Call RM" },
    { name: "ICICI FD", type: "fixed_deposit", value: 200000 },
  ],
  people: [{ name: "Priya", relationship: "Spouse", phone: "+91 88888", email: "p@x.com" }],
  will: { executor: "Priya", location_of_original: "Locker", registered: true },
});

describe("buildRegisterSnapshot", () => {
  it("stamps version and app", () => {
    expect(base.version).toBe(1);
    expect(base.app).toBe("myFinance");
  });
});

// The tier-redaction (formerly `redactForTier`) was removed in the #10 break-glass
// cutover — tiered disclosure now goes through the core break-glass contributor path.
// Its per-tier semantics + byte-parity with the old function are pinned in
// `domain/breakGlassParity.test.ts`.
