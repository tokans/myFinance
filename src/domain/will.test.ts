import { describe, expect, it } from "vitest";
import { buildSimpleWill, reconcileWillVsNominees } from "./will";

describe("reconcileWillVsNominees", () => {
  it("reports only accounts with both nominee and beneficiary, flagging mismatches", () => {
    const holdings = [
      // account 1: nominee = beneficiary (match)
      { account_id: 1, person_id: 10, role: "nominee" },
      { account_id: 1, person_id: 10, role: "beneficiary" },
      // account 2: nominee != beneficiary (mismatch)
      { account_id: 2, person_id: 10, role: "nominee" },
      { account_id: 2, person_id: 11, role: "beneficiary" },
      // account 3: nominee only → skipped
      { account_id: 3, person_id: 12, role: "nominee" },
    ];
    const rows = reconcileWillVsNominees(holdings);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.account_id === 1)!.matches).toBe(true);
    expect(rows.find((r) => r.account_id === 2)!.matches).toBe(false);
    expect(rows.find((r) => r.account_id === 3)).toBeUndefined();
  });
});

describe("buildSimpleWill", () => {
  it("includes the testator, appointed roles, bequests and disclaimer", () => {
    const text = buildSimpleWill({
      testatorName: "Anshuman Das",
      place: "Mumbai",
      executorName: "Priya Sharma",
      guardianName: "Amit Das",
      bequests: [{ item: "my flat in Andheri", toWhom: "my daughter" }],
      residuaryTo: "my spouse",
      date: "2026-05-31",
    });
    expect(text).toContain("LAST WILL AND TESTAMENT");
    expect(text).toContain("Anshuman Das");
    expect(text).toContain("I appoint Priya Sharma as the executor");
    expect(text).toContain("guardian of my minor children");
    expect(text).toContain("my flat in Andheri");
    expect(text).toContain("rest of my estate to my spouse");
    expect(text.toLowerCase()).toContain("not legal advice");
  });

  it("falls back to placeholders when fields are empty", () => {
    const text = buildSimpleWill({ testatorName: "" });
    expect(text).toContain("[Your full name]");
    expect(text).toContain("[date]");
  });
});
