import { describe, expect, it } from "vitest";
import { suggestCategory, suggestCategoryTags, suggestCategoryTagsWithRules, similarByDescription } from "./transactionCategory";

describe("suggestCategory", () => {
  const cases: Array<[string, string]> = [
    ["SALARY CREDIT FROM ACME CORP", "salary_income"],
    ["TRAVEL REIMBURSEMENT MAY 2026", "reimbursement_income"],
    ["EMI DEDUCTION HDFC LOAN", "rent_emi"],
    ["ATM WDL NEW DELHI", "cash_withdrawal"],
    ["UPI-BIGBASKET-ORDER123", "groceries"],
    ["UPI-SWIGGY-ORDER456", "dining_food_delivery"],
    ["BSES ELECTRICITY BILL PAYMENT", "utilities"],
    ["AMAZON.IN PURCHASE", "shopping_retail"],
    ["APOLLO HOSPITAL PAYMENT", "healthcare_medical"],
    ["LIC PREMIUM PAYMENT", "insurance_premium"],
    ["ZERODHA SIP DEBIT", "investment_contribution"],
    ["INCOME TAX CHALLAN PAYMENT", "tax_payment"],
    ["ANNUAL FEE DEBIT CARD", "fees_charges"],
    ["NETFLIX.COM SUBSCRIPTION", "entertainment_subscriptions"],
    ["UBER TRIP PAYMENT", "travel_transport"],
    ["INDIAN OIL PETROL PUMP FUEL", "travel_transport"],
    ["HPCL FUEL STATION PAYMENT", "travel_transport"],
    ["COLLEGE TUITION FEE", "education"],
    ["INT.CR FOR QUARTER", "interest_income"],
    ["QUARTERLY INT PAYOUT", "interest_income"],
    ["DIVIDEND FROM TCS LTD", "dividend_income"],
    ["DIV TCS LTD", "dividend_income"],
    ["RELIANCE INDUSTRIES LIMITED", "dividend_income"],
    ["NEFT TRANSFER TO JOHN DOE", "transfer_other"],
    ["UPI-9876543210@OKICICI", "upi_payment"],
    ["UPI TRANSFER TO WIFE MONTHLY ALLOWANCE", "transfer_family"],
    ["NEFT TO HUSBAND SAVINGS AC", "transfer_family"],
    ["SENT TO MOTHER FOR MEDICINES", "transfer_family"],
    ["RTO CHALLAN PAYMENT NEW CAR", "asset_purchase"],
    ["ROAD TAX PAYMENT RTA OFFICE", "asset_purchase"],
    ["GOLD PURCHASE JEWELLERS", "asset_purchase"],
  ];

  it.each(cases)("classifies %s as %s", (description, expected) => {
    expect(suggestCategory(description)?.category).toBe(expected);
  });

  it("prefers a specific merchant rule over the generic UPI transfer rule", () => {
    expect(suggestCategory("UPI-SWIGGY-987654321")?.category).toBe("dining_food_delivery");
  });

  it("returns null for prose that matches nothing", () => {
    expect(suggestCategory("Cheque deposit no. 123456")).toBeNull();
  });

  it("returns null for a blank description", () => {
    expect(suggestCategory("   ")).toBeNull();
  });

  it("skips the Ltd/Limited dividend guess for a row known to be a debit", () => {
    expect(suggestCategory("PAYMENT TO ABC ENTERPRISES LTD", { isCredit: false })).toBeNull();
  });

  it("skips the bare INT interest guess for a row known to be a debit", () => {
    expect(suggestCategory("INT PAID ON OVERDUE LOAN", { isCredit: false })).toBeNull();
  });

  it("still applies the Ltd/Limited dividend guess when direction is unknown", () => {
    expect(suggestCategory("RELIANCE INDUSTRIES LIMITED")?.category).toBe("dividend_income");
  });

  it("still applies the dividend guess for a row known to be a credit", () => {
    expect(suggestCategory("RELIANCE INDUSTRIES LIMITED", { isCredit: true })?.category).toBe("dividend_income");
  });

  it("recognizes a self-transfer by name part when selfName is supplied", () => {
    expect(suggestCategory("NEFT TO SAMPLE PERSON", { selfName: "Sample Person" })?.category).toBe("transfer_self");
    expect(suggestCategory("IMPS FROM S PERSON SAVINGS", { selfName: "Sample Person" })?.category).toBe("transfer_self");
  });

  it("falls back to the generic transfer rule when selfName is omitted", () => {
    expect(suggestCategory("NEFT TO SAMPLE PERSON")?.category).toBe("transfer_other");
  });

  it("does not match a self-transfer on a short name part (initials)", () => {
    expect(suggestCategory("NEFT TO A D SHARMA", { selfName: "A D" })?.category).not.toBe("transfer_self");
  });

  it("prefers a more specific rule over the self-transfer name match", () => {
    // "Person" happens to also appear here, but SALARY is checked first.
    expect(suggestCategory("SALARY CREDIT FROM PERSON ENTERPRISES", { selfName: "Sample Person" })?.category).toBe("salary_income");
  });
});

describe("suggestCategoryTags", () => {
  it("collects every matching rule, not just the first — a UPI grocery payment gets both tags", () => {
    const cats = suggestCategoryTags("UPI-BIGBASKET-ORDER123").map((s) => s.category);
    expect(cats).toContain("groceries");
    expect(cats).toContain("upi_payment");
  });

  it("excludes a rule category via opts.exclude", () => {
    const cats = suggestCategoryTags("UPI-BIGBASKET-ORDER123", {}, { exclude: ["upi_payment"] }).map((s) => s.category);
    expect(cats).toContain("groceries");
    expect(cats).not.toContain("upi_payment");
  });

  it("returns an empty array for prose that matches nothing", () => {
    expect(suggestCategoryTags("Cheque deposit no. 123456")).toEqual([]);
  });

  it("returns an empty array for a blank description", () => {
    expect(suggestCategoryTags("   ")).toEqual([]);
  });

  it("still skips creditLeaning rules for a known debit", () => {
    const cats = suggestCategoryTags("PAYMENT TO ABC ENTERPRISES LTD", { isCredit: false }).map((s) => s.category);
    expect(cats).not.toContain("dividend_income");
  });

  it("first specific rule wins when two unrelated specific categories both match", () => {
    // Matches groceries' \bgrocer(y|ies)\b AND dining_food_delivery's \bswiggy\b —
    // groceries comes first in RULES, so it should win and dining should be skipped.
    const cats = suggestCategoryTags("GROCERY STORE VIA SWIGGY INSTAMART").map((s) => s.category);
    expect(cats).toContain("groceries");
    expect(cats).not.toContain("dining_food_delivery");
  });

  it("the rail tier still layers on top of the winning specific rule", () => {
    const cats = suggestCategoryTags("UPI PAYMENT AT BIGBASKET GROCERY").map((s) => s.category);
    expect(cats).toContain("groceries");
    expect(cats).toContain("upi_payment");
  });

  it("tags static matches with source and the matched keyword", () => {
    const [groceries] = suggestCategoryTags("UPI-BIGBASKET-ORDER123");
    expect(groceries).toMatchObject({ category: "groceries", source: "static" });
    expect(groceries.matchedKeyword).toMatch(/bigbasket/i);
  });
});

describe("suggestCategoryTagsWithRules", () => {
  it("surfaces a learned category alongside the heuristic matches", () => {
    const learned = new Map([["upi-acme-#", ["salary_income"]]]);
    const cats = suggestCategoryTagsWithRules("UPI-ACME-111", learned).map((s) => s.category);
    expect(cats).toContain("salary_income");
    expect(cats).toContain("upi_payment");
  });

  it("digit-collapses the learned-rule lookup key, same as similarByDescription", () => {
    const learned = new Map([["upi-acme-#", ["salary_income"]]]);
    expect(suggestCategoryTagsWithRules("UPI-ACME-222", learned).map((s) => s.category)).toContain("salary_income");
  });

  it("falls back to pure heuristic matches when nothing is learned for this pattern", () => {
    const cats = suggestCategoryTagsWithRules("UPI-SWIGGY-111", new Map()).map((s) => s.category);
    expect(cats).toEqual(expect.arrayContaining(["dining_food_delivery", "upi_payment"]));
  });

  it("a learned category not covered by any static rule still surfaces", () => {
    const learned = new Map([["totally unmatched narration", ["asset_purchase"]]]);
    expect(suggestCategoryTagsWithRules("Totally unmatched narration", learned).map((s) => s.category)).toEqual(["asset_purchase"]);
  });

  it("respects opts.exclude for both the learned and heuristic halves", () => {
    const learned = new Map([["upi-bigbasket-order#", ["upi_payment"]]]);
    const cats = suggestCategoryTagsWithRules("UPI-BIGBASKET-ORDER123", learned, {}, { exclude: ["upi_payment"] }).map((s) => s.category);
    expect(cats).not.toContain("upi_payment");
    expect(cats).toContain("groceries");
  });

  it("de-duplicates when a category is both learned and heuristically matched", () => {
    const learned = new Map([["upi-bigbasket-order#", ["groceries"]]]);
    const cats = suggestCategoryTagsWithRules("UPI-BIGBASKET-ORDER123", learned).map((s) => s.category);
    expect(cats.filter((c) => c === "groceries")).toHaveLength(1);
  });

  it("a learned specific category blocks a later conflicting static specific rule, but not the rail rule", () => {
    // Taught "salary_income" for this exact narration pattern — the static
    // "dividend_income" rule would also match ("Ltd"), but since a learned
    // SPECIFIC category already won, it must not also surface.
    const learned = new Map([["upi-acme ltd-#", ["salary_income"]]]);
    const cats = suggestCategoryTagsWithRules("UPI-ACME LTD-111", learned).map((s) => s.category);
    expect(cats).toContain("salary_income");
    expect(cats).not.toContain("dividend_income");
    expect(cats).toContain("upi_payment");
  });

  it("tags each suggestion with its source and identifying detail", () => {
    const learned = new Map([["upi-acme-#", ["salary_income"]]]);
    const suggestions = suggestCategoryTagsWithRules("UPI-ACME-111", learned);
    const learnedTag = suggestions.find((s) => s.category === "salary_income");
    const staticTag = suggestions.find((s) => s.category === "upi_payment");
    expect(learnedTag).toMatchObject({ source: "learned", learnedPattern: "upi-acme-#" });
    expect(staticTag?.source).toBe("static");
    expect(staticTag?.matchedKeyword).toMatch(/upi/i);
  });
});

describe("similarByDescription", () => {
  it("matches rows whose description differs only by digits", () => {
    const rows = [
      { id: 1, description: "UPI-SWIGGY-111111" },
      { id: 2, description: "UPI-SWIGGY-222222" },
      { id: 3, description: "UPI-ZOMATO-333333" },
    ];
    expect(similarByDescription("UPI-SWIGGY-999999", rows).sort()).toEqual([1, 2]);
  });

  it("returns an empty list for a blank seed", () => {
    expect(similarByDescription("   ", [{ id: 1, description: "x" }])).toEqual([]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(similarByDescription("UNRELATED", [{ id: 1, description: "UPI-SWIGGY-111111" }])).toEqual([]);
  });
});
