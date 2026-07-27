import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@/db/settings", () => ({
  getSetting: vi.fn(async (key: string) => store.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
}));

import {
  ALL_FIXED_CATEGORIES,
  labelForSystemCategory,
  learnCaLabel,
  loadLearnedCaLabelRules,
  reconcileCaComputation,
  type CaReconSystemData,
} from "./caReconciliation";

const EMPTY_SYSTEM: CaReconSystemData = { income: [], deductions: [], payments: [], assessment: null };

describe("reconcileCaComputation — fixed categories", () => {
  it("matches a CA line item to a system row with the same fixed category", () => {
    const system: CaReconSystemData = { ...EMPTY_SYSTEM, income: [{ head: "salary", amount: 1200000 }] };
    const result = reconcileCaComputation([{ label: "Income from Salary", amount: 1200000 }], system, []);
    expect(result.matched).toEqual([
      { caLabel: "Income from Salary", caAmount: 1200000, systemLabel: "Salary", systemAmount: 1200000 },
    ]);
    expect(result.missingInSystem).toEqual([]);
    expect(result.unclassified).toEqual([]);
  });

  it("flags a classified CA category as missing-in-system when this app has no rows for it", () => {
    const result = reconcileCaComputation([{ label: "Dividend Income", amount: 5000 }], EMPTY_SYSTEM, []);
    expect(result.missingInSystem).toEqual([
      { label: "Dividend income", kind: "income", caAmount: 5000 },
    ]);
    expect(result.matched).toEqual([]);
  });

  it("flags a non-zero system category as missing-in-CA-doc when no CA line item matched it", () => {
    const system: CaReconSystemData = { ...EMPTY_SYSTEM, payments: [{ type: "advance", amount: 30000 }] };
    const result = reconcileCaComputation([], system, []);
    expect(result.missingInCaDoc).toContainEqual({ label: "Advance tax", kind: "payment", systemAmount: 30000 });
  });

  it("never flags a zero/absent system category as missing-in-CA-doc", () => {
    const result = reconcileCaComputation([], EMPTY_SYSTEM, []);
    expect(result.missingInCaDoc).toEqual([]);
  });

  it("surfaces an ambiguous CA label (matches two distinct fixed categories) as unclassified with candidates listed", () => {
    // Deliberately-conflicting keywords via a learned rule to exercise the ambiguity path.
    const result = reconcileCaComputation(
      [{ label: "Gross Total Income for the year", amount: 1500000 }],
      EMPTY_SYSTEM,
      [{ keyword: "gross total income", category: "assessment:total_income" }],
    );
    expect(result.unclassified).toHaveLength(1);
    expect(result.unclassified[0].candidates.sort()).toEqual(
      ["assessment:gross_total_income", "assessment:total_income"].sort(),
    );
  });

  it("surfaces a completely unrecognized CA label as unclassified with no candidates", () => {
    const result = reconcileCaComputation([{ label: "Miscellaneous adjustment XYZ", amount: 100 }], EMPTY_SYSTEM, []);
    expect(result.unclassified).toEqual([{ caLabel: "Miscellaneous adjustment XYZ", caAmount: 100, candidates: [] }]);
  });
});

describe("reconcileCaComputation — deduction sections (open vocabulary, fuzzy entity match)", () => {
  it("fuzzy-matches a CA deduction label against an on-file section string", () => {
    const system: CaReconSystemData = { ...EMPTY_SYSTEM, deductions: [{ section: "80C", amount: 150000 }] };
    const result = reconcileCaComputation([{ label: "Deduction under Section 80C", amount: 150000 }], system, []);
    expect(result.matched).toEqual([
      { caLabel: "Deduction under Section 80C", caAmount: 150000, systemLabel: "Deduction 80C", systemAmount: 150000 },
    ]);
  });

  it("flags an on-file deduction section as missing-in-CA-doc when no CA line item matched it", () => {
    const system: CaReconSystemData = { ...EMPTY_SYSTEM, deductions: [{ section: "80D", amount: 25000 }] };
    const result = reconcileCaComputation([], system, []);
    expect(result.missingInCaDoc).toEqual([{ label: "Deduction 80D", kind: "deduction", systemAmount: 25000 }]);
  });
});

describe("assessment totals", () => {
  it("matches a total-income-shaped CA line against the assessment row", () => {
    const system: CaReconSystemData = {
      ...EMPTY_SYSTEM,
      assessment: {
        ay: "2026-27", gross_total_income: 1200000, total_deductions: 150000, total_income: 1050000,
        total_tax_payable: null, rebate_87a: null, education_cess: null,
        net_tax_liability: 120000, total_taxes_paid: 100000, refund_or_balance: -20000, updated_at: "",
      },
    };
    const result = reconcileCaComputation([{ label: "Net Tax Liability", amount: 120000 }], system, []);
    expect(result.matched).toEqual([
      { caLabel: "Net Tax Liability", caAmount: 120000, systemLabel: "Net tax liability", systemAmount: 120000 },
    ]);
  });
});

describe("learned rules", () => {
  beforeEach(() => store.clear());

  it("persists a learned label and applies it on the next reconciliation", async () => {
    const noLearn = reconcileCaComputation([{ label: "Housing loan interest deduction", amount: 200000 }], EMPTY_SYSTEM, []);
    expect(noLearn.unclassified).toHaveLength(1);

    await learnCaLabel("housing loan interest", "income:house_property");
    const learned = await loadLearnedCaLabelRules();
    expect(learned).toEqual([{ keyword: "housing loan interest", category: "income:house_property" }]);

    const withLearn = reconcileCaComputation([{ label: "Housing loan interest deduction", amount: 200000 }], EMPTY_SYSTEM, learned);
    expect(withLearn.unclassified).toEqual([]);
    expect(withLearn.missingInSystem).toEqual([{ label: "House property", kind: "income", caAmount: 200000 }]);
  });

  it("overwrites (last-write-wins) a prior learned mapping for the same keyword", async () => {
    await learnCaLabel("misc income", "income:other_sources");
    await learnCaLabel("misc income", "income:business");
    const learned = await loadLearnedCaLabelRules();
    expect(learned).toEqual([{ keyword: "misc income", category: "income:business" }]);
  });
});

describe("labelForSystemCategory / ALL_FIXED_CATEGORIES", () => {
  it("has a label for every fixed category", () => {
    for (const c of ALL_FIXED_CATEGORIES) {
      expect(typeof labelForSystemCategory(c)).toBe("string");
      expect(labelForSystemCategory(c).length).toBeGreaterThan(0);
    }
  });
});
