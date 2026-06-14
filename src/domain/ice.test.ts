import { describe, expect, it } from "vitest";
import { buildIceLines, iceCardText, iceContactsWithPhone, isIceEmpty } from "./ice";

describe("buildIceLines", () => {
  it("includes only non-empty fields, in order", () => {
    const lines = buildIceLines({
      fullName: "Anshuman Das",
      bloodGroup: "O+",
      allergies: "",
      conditions: "Hypertension",
      medications: null,
      organDonor: true,
      contacts: [],
    });
    expect(lines).toEqual([
      { label: "Name", value: "Anshuman Das" },
      { label: "Blood group", value: "O+" },
      { label: "Conditions", value: "Hypertension" },
      { label: "Organ donor", value: "Yes" },
    ]);
  });

  it("omits organ donor when false", () => {
    const lines = buildIceLines({ fullName: "X", organDonor: false, contacts: [] });
    expect(lines.find((l) => l.label === "Organ donor")).toBeUndefined();
  });
});

describe("iceContactsWithPhone", () => {
  it("keeps only contacts with a phone", () => {
    const kept = iceContactsWithPhone([
      { name: "A", phone: "123456" },
      { name: "B", phone: "" },
      { name: "C", phone: null },
    ]);
    expect(kept.map((c) => c.name)).toEqual(["A"]);
  });
});

describe("iceCardText", () => {
  it("renders a card with contacts and disclaimer", () => {
    const text = iceCardText({
      fullName: "Anshuman",
      bloodGroup: "O+",
      contacts: [{ name: "Priya", relationship: "Spouse", phone: "+91 99999 88888" }],
    });
    expect(text).toContain("IN CASE OF EMERGENCY");
    expect(text).toContain("Blood group: O+");
    expect(text).toContain("Priya (Spouse) — +91 99999 88888");
    expect(text.toLowerCase()).toContain("emergency services");
  });
});

describe("isIceEmpty", () => {
  it("is true with no fields and no phone contacts", () => {
    expect(isIceEmpty({ contacts: [{ name: "A", phone: "" }] })).toBe(true);
    expect(isIceEmpty({ fullName: "A", contacts: [] })).toBe(false);
  });
});
