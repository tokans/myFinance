import { describe, expect, it } from "vitest";
import { computeTax } from "./taxCompute";

describe("computeTax — new regime (FY 2025-26)", () => {
  it("₹10L is fully rebated to zero (income ≤ ₹12L)", () => {
    const r = computeTax(1_000_000, "new");
    // 0-4L:0 + 4-8L:5%×4L=20000 + 8-10L:10%×2L=20000 = 40000, rebated in full.
    expect(r.taxBeforeRebate).toBe(40_000);
    expect(r.rebate87A).toBe(40_000);
    expect(r.totalTax).toBe(0);
  });

  it("₹13L pays slab tax + 4% cess (rebate lost above ₹12L)", () => {
    const r = computeTax(1_300_000, "new");
    // 20000 + 40000 + 15%×1L=15000 = 75000; cess 4% = 3000.
    expect(r.taxBeforeRebate).toBe(75_000);
    expect(r.rebate87A).toBe(0);
    expect(r.cess).toBe(3_000);
    expect(r.totalTax).toBe(78_000);
  });
});

describe("computeTax — old regime (FY 2025-26)", () => {
  it("₹4L is fully rebated (income ≤ ₹5L)", () => {
    const r = computeTax(400_000, "old");
    expect(r.taxBeforeRebate).toBe(7_500); // 5% × (4L-2.5L)
    expect(r.totalTax).toBe(0);
  });

  it("₹12L slab tax + cess", () => {
    const r = computeTax(1_200_000, "old");
    // 5%×2.5L=12500 + 20%×5L=100000 + 30%×2L=60000 = 172500; cess 4% = 6900.
    expect(r.taxBeforeRebate).toBe(172_500);
    expect(r.cess).toBe(6_900);
    expect(r.totalTax).toBe(179_400);
  });

  it("applies surcharge above ₹50L", () => {
    const r = computeTax(6_000_000, "old");
    expect(r.surcharge).toBeGreaterThan(0);
  });
});
