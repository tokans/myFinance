import { describe, it, expect } from "vitest";
import { inferAccountType, accountTypeKind } from "./accountTypes";

describe("inferAccountType", () => {
  it("matches type keywords anywhere in the name", () => {
    expect(inferAccountType("HDFC Home Loan")).toBe("loan");
    expect(inferAccountType("ICICI Credit Card")).toBe("credit_card");
    // A bare "Credit" suffix (no "Card") still resolves to credit_card rather
    // than falling through to the institution's implied type (e.g. bank_savings).
    expect(inferAccountType("HDFC Credit (1234)")).toBe("credit_card");
    expect(inferAccountType("SBI PPF Account")).toBe("ppf");
    expect(inferAccountType("Axis FD")).toBe("fixed_deposit");
    expect(inferAccountType("Zerodha Stocks")).toBe("stocks");
    expect(inferAccountType("Gold ETF Holding")).toBe("etf");
    expect(inferAccountType("My Crypto Wallet")).toBe("crypto");
  });

  it("prefers the more specific type", () => {
    // "PPF" wins over the generic "savings".
    expect(inferAccountType("PPF Savings")).toBe("ppf");
    // "Recurring Deposit" matches its own type, not a bare deposit read.
    expect(inferAccountType("Post Office Recurring Deposit")).toBe("recurring_deposit");
  });

  it("is whole-word — does not match substrings", () => {
    // "fd" must not fire inside "fund"; a bare "fund" isn't a keyword → null.
    expect(inferAccountType("Index Fund")).toBeNull();
    expect(inferAccountType("Random Brokerage")).toBeNull();
    // Plural tolerance must not re-open mid-word matches: "rd" in "standard".
    expect(inferAccountType("Standard Chartered")).toBeNull();
  });

  it("tolerates plural abbreviations (MFs, FDs, ETFs)", () => {
    expect(inferAccountType("Axis MFs")).toBe("mutual_funds");
    expect(inferAccountType("My FDs")).toBe("fixed_deposit");
    expect(inferAccountType("Gold ETFs")).toBe("etf");
    expect(inferAccountType("Reliance Mutual Funds")).toBe("mutual_funds");
  });

  it("returns null when nothing matches", () => {
    expect(inferAccountType("")).toBeNull();
    expect(inferAccountType(null)).toBeNull();
    expect(inferAccountType("HDFC Bank")).toBeNull();
  });

  it("inferred liability types subtract from net worth", () => {
    expect(accountTypeKind(inferAccountType("Car Loan")!)).toBe("liability");
    expect(accountTypeKind(inferAccountType("Amex Credit Card")!)).toBe("liability");
  });

  it("distinguishes loan_given (money lent out, an asset) from the generic loan liability", () => {
    expect(inferAccountType("Loan Given to Raj")).toBe("loan_given");
    expect(inferAccountType("Money Lent to Priya")).toBe("loan_given");
    expect(accountTypeKind(inferAccountType("Loan Given to Raj")!)).toBe("asset");
    // Regression: a bare "loan" (no "given"/"lent") must still resolve to the
    // liability type, never loan_given.
    expect(inferAccountType("Car Loan")).toBe("loan");
    expect(inferAccountType("Home Loan")).toBe("loan");
  });

  it("matches vehicle and art_collectible without stealing more specific types", () => {
    expect(inferAccountType("My Car")).toBe("vehicle");
    expect(inferAccountType("Royal Enfield Bike")).toBe("vehicle");
    expect(inferAccountType("Family Yacht")).toBe("vehicle");
    expect(inferAccountType("Antique Painting")).toBe("art_collectible");
    expect(inferAccountType("Sculpture Collection")).toBe("art_collectible");
    // Regression: "Car Insurance"/"Car Loan" must still resolve to their more
    // specific type, not vehicle (vehicle is ordered after both).
    expect(inferAccountType("Car Insurance")).toBe("insurance");
    expect(inferAccountType("Car Loan")).toBe("loan");
  });

  it("maps tax names to tax_refund, but lets specific types win", () => {
    expect(inferAccountType("Income Tax Refund")).toBe("tax_refund");
    expect(inferAccountType("Advance Tax")).toBe("tax_refund");
    expect(inferAccountType("Tax")).toBe("tax_refund");
    // A specific deposit/fund type still wins over the generic "tax" word.
    expect(inferAccountType("Tax Saver FD")).toBe("fixed_deposit");
    expect(inferAccountType("ELSS Tax Saver Mutual Fund")).toBe("mutual_funds");
    // tax_refund is an asset (summed with sign; a negative balance = tax payable).
    expect(accountTypeKind("tax_refund")).toBe("asset");
  });
});
