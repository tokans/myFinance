import { describe, expect, it } from "vitest";
import { mapPeopleSheet, resolvePeopleColumns } from "./peopleImport";

describe("resolvePeopleColumns", () => {
  it("maps headers by keyword", () => {
    const header = ["Name", "Relationship", "Mobile", "Email"];
    expect(resolvePeopleColumns(header)).toEqual({ nameCol: 0, relCol: 1, phoneCol: 2, emailCol: 3 });
  });

  it("falls back to column 0 for the name when no name header", () => {
    const header = ["Contact", "Phone"];
    const m = resolvePeopleColumns(header);
    expect(m.nameCol).toBe(0);
  });

  it("does not assign the same column twice", () => {
    // "Contact" matches phone keywords but is the name column here.
    const header = ["Contact name", "Email", "Relation"];
    const m = resolvePeopleColumns(header);
    expect(m.nameCol).toBe(0);
    expect(m.emailCol).toBe(1);
    expect(m.relCol).toBe(2);
    expect(m.phoneCol).not.toBe(0);
  });
});

describe("mapPeopleSheet", () => {
  it("extracts people from data rows, skipping nameless rows", () => {
    const rows: (string | number | null)[][] = [
      ["Name", "Relationship", "Phone", "Email"],
      ["Priya Sharma", "Spouse", "+91 98765 43210", "priya@example.com"],
      [null, "Friend", "123", "x@example.com"],
      ["Amit", "Executor", null, null],
    ];
    const people = mapPeopleSheet(rows);
    expect(people).toHaveLength(2);
    expect(people[0]).toMatchObject({
      name: "Priya Sharma",
      relationship: "Spouse",
      phone: "+91 98765 43210",
      email: "priya@example.com",
      access_tier: 0,
    });
    expect(people[1]).toMatchObject({ name: "Amit", relationship: "Executor", phone: null, email: null });
  });

  it("returns empty for an empty sheet", () => {
    expect(mapPeopleSheet([])).toEqual([]);
  });
});
