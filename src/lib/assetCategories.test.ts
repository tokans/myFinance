import { describe, it, expect } from "vitest";
import { assetCategoryForType, ASSET_CATEGORIES } from "./assetCategories";
import { ACCOUNT_TYPES } from "./accountTypes";

describe("assetCategoryForType", () => {
  it("maps every category's own types back to itself", () => {
    for (const cat of ASSET_CATEGORIES) {
      for (const type of cat.types) {
        expect(assetCategoryForType(type)).toBe(cat.value);
      }
    }
  });

  it("maps the deposit-style types to bank", () => {
    expect(assetCategoryForType("bank_savings")).toBe("bank");
    expect(assetCategoryForType("checking")).toBe("bank");
    expect(assetCategoryForType("fixed_deposit")).toBe("bank");
    expect(assetCategoryForType("recurring_deposit")).toBe("bank");
  });

  it("maps market/fund types to shares_securities", () => {
    for (const t of ["stocks", "mutual_funds", "etf", "bonds", "pms_aif"]) {
      expect(assetCategoryForType(t)).toBe("shares_securities");
    }
  });

  it("keeps retirement vehicles in their own provident_pension category, not bank", () => {
    for (const t of ["ppf", "epf", "nps"]) {
      expect(assetCategoryForType(t)).toBe("provident_pension");
    }
  });

  it("excludes tax_refund and both liability types from the breakdown", () => {
    expect(assetCategoryForType("tax_refund")).toBeNull();
    expect(assetCategoryForType("loan")).toBeNull();
    expect(assetCategoryForType("credit_card")).toBeNull();
  });

  it("maps 'other' to its own Others category", () => {
    expect(assetCategoryForType("other")).toBe("other");
  });

  it("has no orphaned account type — every AccountType is either categorized or explicitly excluded", () => {
    const categorized = new Set(ASSET_CATEGORIES.flatMap((c) => c.types));
    const excluded = new Set(["tax_refund", "loan", "credit_card"]);
    for (const t of ACCOUNT_TYPES) {
      expect(categorized.has(t.value) || excluded.has(t.value)).toBe(true);
    }
  });

  it("returns null for an unknown type", () => {
    expect(assetCategoryForType("not_a_real_type")).toBeNull();
  });
});
