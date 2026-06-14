import { describe, it, expect } from "vitest";
import { mergeMasterOptions, pickMode, DROPDOWN_MAX } from "./store";
import type { MasterOption } from "./types";

const opt = (value: string, source: MasterOption["source"] = "baked"): MasterOption => ({
  value,
  label: value,
  source,
});

describe("pickMode", () => {
  it(`is a dropdown below ${DROPDOWN_MAX} options and autocomplete at/above`, () => {
    expect(pickMode(0)).toBe("dropdown");
    expect(pickMode(DROPDOWN_MAX - 1)).toBe("dropdown");
    expect(pickMode(DROPDOWN_MAX)).toBe("autocomplete");
    expect(pickMode(DROPDOWN_MAX + 50)).toBe("autocomplete");
  });
});

describe("mergeMasterOptions", () => {
  it("keeps baked order, then live-only, then custom", () => {
    const baked = [opt("INR"), opt("USD")];
    const live = [opt("USD", "live"), opt("EUR", "live")];
    const custom = [opt("XYZ", "custom")];
    const merged = mergeMasterOptions(baked, live, custom).map((o) => o.value);
    expect(merged).toEqual(["INR", "USD", "EUR", "XYZ"]);
  });

  it("de-dupes case-insensitively, first occurrence wins", () => {
    const merged = mergeMasterOptions([opt("Mumbai")], [opt("mumbai", "live")], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("baked");
  });

  it("tolerates a null live source (offline)", () => {
    const merged = mergeMasterOptions([opt("INR")], null, [opt("ABC", "custom")]);
    expect(merged.map((o) => o.value)).toEqual(["INR", "ABC"]);
  });

  it("drops blank values", () => {
    const merged = mergeMasterOptions([opt("  ")], null, [opt("INR")]);
    expect(merged.map((o) => o.value)).toEqual(["INR"]);
  });
});
