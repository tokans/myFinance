import { describe, expect, it } from "vitest";
import {
  inferInstitution,
  institutionImpliedType,
  inferAccountTypeForName,
} from "./institutions";

describe("inferInstitution", () => {
  it("matches a distinctive token embedded in the account name", () => {
    expect(inferInstitution("HDFC Savings")).toBe("HDFC Bank");
    expect(inferInstitution("My Axis salary account")).toBe("Axis Bank");
    expect(inferInstitution("Zerodha demat")).toBe("Zerodha");
    expect(inferInstitution("Baroda FD")).toBe("Bank of Baroda");
  });

  it("matches case-insensitively and across punctuation/joins", () => {
    expect(inferInstitution("icici-direct")).toBe("ICICI Direct");
    expect(inferInstitution("CITIBANK NRI")).toBe("Citibank");
  });

  it("prefers the full institution phrase over a single shared word", () => {
    expect(inferInstitution("Standard Chartered priority")).toBe("Standard Chartered");
  });

  it("breaks ties by list order (banks before brokerages)", () => {
    // "HDFC" alone appears in both HDFC Bank and HDFC Securities; bank wins.
    expect(inferInstitution("HDFC account")).toBe("HDFC Bank");
  });

  it("never matches on a generic word alone", () => {
    expect(inferInstitution("Family Bank box")).toBeNull();
    expect(inferInstitution("India savings")).toBeNull();
  });

  it("returns null when nothing distinctive matches or input is empty", () => {
    expect(inferInstitution("Cash wallet")).toBeNull();
    expect(inferInstitution("")).toBeNull();
    expect(inferInstitution(null)).toBeNull();
    expect(inferInstitution(undefined)).toBeNull();
  });

  it("does not match a short fragment that isn't a whole word", () => {
    // "hsbc" must not match inside an unrelated run of letters.
    expect(inferInstitution("Thsbcx holdings")).toBeNull();
  });

  it("resolves acronym aliases not present as baked labels", () => {
    expect(inferInstitution("SBI FD")).toBe("State Bank of India");
    expect(inferInstitution("PNB account")).toBe("Punjab National Bank");
    // Glued form (zero separators) still resolves the leading acronym.
    expect(inferInstitution("SBIFD")).toBe("State Bank of India");
    expect(inferInstitution("AXIS MF")).toBe("Axis Bank");
  });
});

describe("institutionImpliedType", () => {
  it("maps banks → savings, brokers → stocks, MF platforms → mutual funds", () => {
    expect(institutionImpliedType("HDFC Bank")).toBe("bank_savings");
    expect(institutionImpliedType("State Bank of India")).toBe("bank_savings");
    expect(institutionImpliedType("Zerodha")).toBe("stocks");
    expect(institutionImpliedType("ICICI Direct")).toBe("stocks");
    expect(institutionImpliedType("Coin by Zerodha")).toBe("mutual_funds");
  });

  it("returns null for unknown / empty institutions", () => {
    expect(institutionImpliedType("Some Random Co")).toBeNull();
    expect(institutionImpliedType(null)).toBeNull();
  });
});

describe("inferAccountTypeForName", () => {
  it("prefers an explicit type word over the institution's implied type", () => {
    expect(inferAccountTypeForName("SBI FD")).toBe("fixed_deposit");
    expect(inferAccountTypeForName("AXIS MF")).toBe("mutual_funds");
    expect(inferAccountTypeForName("HDFC Credit Card")).toBe("credit_card");
  });

  it("falls back to the institution's implied type when the name has no type word", () => {
    expect(inferAccountTypeForName("SBI")).toBe("bank_savings");
    expect(inferAccountTypeForName("Zerodha")).toBe("stocks");
    expect(inferAccountTypeForName("My HDFC Bank account")).toBe("bank_savings");
  });

  it("returns null when neither the name nor an institution yields a guess", () => {
    expect(inferAccountTypeForName("Misc holding")).toBeNull();
    expect(inferAccountTypeForName("")).toBeNull();
  });

  it("resolves a type glued onto an institution acronym", () => {
    expect(inferAccountTypeForName("AXISBMF")).toBe("mutual_funds");
    expect(inferAccountTypeForName("SBIFD")).toBe("fixed_deposit");
    expect(inferAccountTypeForName("HDFCRD")).toBe("recurring_deposit");
    expect(inferAccountTypeForName("ICICIPPF")).toBe("ppf");
    // institution is still resolved alongside the glued type.
    expect(inferInstitution("AXISBMF")).toBe("Axis Bank");
  });

  it("does not misread a type abbreviation out of an ordinary word", () => {
    // No acronym prefix → no glued scan: "standard"/"chartered" never yield "rd".
    expect(inferAccountTypeForName("Standard Chartered")).toBe("bank_savings");
    // Acronym present but the leftover ends in "ds", not "rd".
    expect(inferAccountTypeForName("AXISREWARDS")).toBe("bank_savings");
  });
});
