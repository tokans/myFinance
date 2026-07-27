import { describe, expect, it } from "vitest";
import { STATEMENT_TEMPLATES, templateFor } from "./institutionTemplates";

describe("templateFor", () => {
  it("returns null for a null/undefined/empty institution", () => {
    expect(templateFor(null)).toBeNull();
    expect(templateFor(undefined)).toBeNull();
    expect(templateFor("")).toBeNull();
  });

  it("returns null for an institution with no registered template", () => {
    expect(templateFor("Some Brokerage Nobody Has Seeded")).toBeNull();
  });

  it("returns the registered template for a known institution", () => {
    const t = templateFor("HDFC Bank");
    expect(t?.institution).toBe("HDFC Bank");
    expect(t?.columnWords.description?.test("Narration")).toBe(true);
  });

  it("every seed template's institution is unique", () => {
    const names = STATEMENT_TEMPLATES.map((t) => t.institution);
    expect(new Set(names).size).toBe(names.length);
  });
});
