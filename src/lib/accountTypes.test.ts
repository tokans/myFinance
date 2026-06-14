import { describe, it, expect } from "vitest";
import { inferAccountType, accountTypeKind } from "./accountTypes";

describe("inferAccountType", () => {
  it("matches type keywords anywhere in the name", () => {
    expect(inferAccountType("HDFC Home Loan")).toBe("loan");
    expect(inferAccountType("ICICI Credit Card")).toBe("credit_card");
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
