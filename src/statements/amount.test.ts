import { describe, expect, it } from "vitest";
import { parseAmount } from "./amount";

describe("parseAmount", () => {
  it("parses a plain number", () => {
    expect(parseAmount("50000")).toBe(50000);
  });

  it("strips thousands separators", () => {
    expect(parseAmount("1,250.50")).toBe(1250.5);
  });

  it("strips a currency prefix", () => {
    expect(parseAmount("₹1,250")).toBe(1250);
    expect(parseAmount("Rs. 1,250")).toBe(1250);
    expect(parseAmount("INR 1250")).toBe(1250);
  });

  it("treats parenthesized amounts as negative", () => {
    expect(parseAmount("(500.00)")).toBe(-500);
  });

  it("returns null for non-numeric text", () => {
    expect(parseAmount("Salary credit")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});
