import { describe, it, expect } from "vitest";
import { recommendItr, DEFAULT_WIZARD_INPUTS } from "./recommendItr";

describe("recommendItr", () => {
  it("defaults to ITR-1 for a salaried resident individual under ₹50L", () => {
    const r = recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 1_500_000 });
    expect(r.form).toBe("1");
    expect(r.blockedFromItr1).toHaveLength(0);
  });

  it("blocks ITR-1 when total income exceeds ₹50L → falls to ITR-2", () => {
    const r = recommendItr({ ...DEFAULT_WIZARD_INPUTS, totalIncome: 6_000_000 });
    expect(r.form).toBe("2");
    expect(r.blockedFromItr1.some((x) => x.includes("50"))).toBe(true);
  });

  it("blocks ITR-1 on capital gains → ITR-2", () => {
    const r = recommendItr({ ...DEFAULT_WIZARD_INPUTS, hasCapitalGains: true });
    expect(r.form).toBe("2");
  });

  it("routes presumptive business income to ITR-4", () => {
    const r = recommendItr({
      ...DEFAULT_WIZARD_INPUTS,
      totalIncome: 3_000_000,
      hasBusinessIncome: true,
      hasPresumptiveOnly: true,
    });
    expect(r.form).toBe("4");
  });

  it("routes non-presumptive business income to ITR-3", () => {
    const r = recommendItr({
      ...DEFAULT_WIZARD_INPUTS,
      hasBusinessIncome: true,
      hasPresumptiveOnly: false,
    });
    expect(r.form).toBe("3");
  });

  it("blocks ITR-4 on foreign assets, even with presumptive scheme → ITR-3", () => {
    const r = recommendItr({
      ...DEFAULT_WIZARD_INPUTS,
      hasBusinessIncome: true,
      hasPresumptiveOnly: true,
      hasForeignAssetsOrIncome: true,
    });
    expect(r.form).toBe("3");
    expect(r.blockedFromItr4.some((x) => /foreign/i.test(x))).toBe(true);
  });

  it("blocks ITR-1 on director status and foreign income simultaneously", () => {
    const r = recommendItr({
      ...DEFAULT_WIZARD_INPUTS,
      isDirector: true,
      hasForeignAssetsOrIncome: true,
    });
    expect(r.form).toBe("2");
    expect(r.blockedFromItr1.some((x) => /director/i.test(x))).toBe(true);
    expect(r.blockedFromItr1.some((x) => /foreign/i.test(x))).toBe(true);
  });

  it("blocks ITR-1 on multiple house properties → ITR-2", () => {
    const r = recommendItr({ ...DEFAULT_WIZARD_INPUTS, hasMultipleHouses: true });
    expect(r.form).toBe("2");
  });

  it("blocks ITR-1 on agri income > ₹5,000 → ITR-2", () => {
    const r = recommendItr({ ...DEFAULT_WIZARD_INPUTS, agriIncomeAbove5000: true });
    expect(r.form).toBe("2");
  });
});
