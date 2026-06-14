import { describe, it, expect } from "vitest";
import {
  parseMonth, formatMonth, addMonths, diffMonths, compareMonths,
  fyStartForMonth, computeDashboard, carryForwardSeries, estimateAnnualSavings,
  polynomialTrendEstimate,
} from "./calc";

describe("month helpers", () => {
  it("parseMonth and formatMonth round-trip", () => {
    expect(parseMonth("2026-04")).toEqual({ year: 2026, month: 4 });
    expect(formatMonth(2026, 4)).toBe("2026-04");
    expect(formatMonth(2026, 12)).toBe("2026-12");
  });

  it("addMonths handles year rollovers", () => {
    expect(addMonths("2026-01", 0)).toBe("2026-01");
    expect(addMonths("2026-01", 1)).toBe("2026-02");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", 24)).toBe("2028-06");
  });

  it("diffMonths returns signed delta", () => {
    expect(diffMonths("2026-04", "2026-01")).toBe(3);
    expect(diffMonths("2026-01", "2026-04")).toBe(-3);
    expect(diffMonths("2027-01", "2026-01")).toBe(12);
  });

  it("compareMonths sorts chronologically", () => {
    const months = ["2026-04", "2025-12", "2026-01"];
    expect([...months].sort(compareMonths)).toEqual(["2025-12", "2026-01", "2026-04"]);
  });
});

describe("fyStartForMonth", () => {
  it("calendar FY (Jan start)", () => {
    expect(fyStartForMonth("2026-04", 1)).toBe("2026-01");
    expect(fyStartForMonth("2026-01", 1)).toBe("2026-01");
    expect(fyStartForMonth("2026-12", 1)).toBe("2026-01");
  });

  it("Indian FY (April start)", () => {
    expect(fyStartForMonth("2026-05", 4)).toBe("2026-04");
    expect(fyStartForMonth("2026-04", 4)).toBe("2026-04");
    // Months before April → previous calendar year's April
    expect(fyStartForMonth("2026-03", 4)).toBe("2025-04");
    expect(fyStartForMonth("2026-01", 4)).toBe("2025-04");
  });
});

describe("computeDashboard", () => {
  it("returns empty snapshot when no data", () => {
    const r = computeDashboard(new Map(), 4);
    expect(r.latestMonth).toBeNull();
    expect(r.totalSavings).toBe(0);
    expect(r.mom).toBeNull();
    expect(r.fyStart).toBeNull();
  });

  it("computes MoM delta from prior month", () => {
    const r = computeDashboard(new Map([
      ["2026-03", 100_000],
      ["2026-04", 120_000],
    ]), 4);
    expect(r.latestMonth).toBe("2026-04");
    expect(r.totalSavings).toBe(120_000);
    expect(r.mom).toEqual({ previousMonth: "2026-03", previousValue: 100_000, delta: 20_000 });
  });

  it("anchors FY start to the closest prior month when exact month missing", () => {
    const r = computeDashboard(new Map([
      ["2026-02", 50_000],
      ["2026-05", 80_000],
    ]), 4);
    // FY for May 2026 = April 2026, no data — falls back to Feb 2026.
    expect(r.fyStart?.startMonth).toBe("2026-02");
    expect(r.fyStart?.delta).toBe(30_000);
  });

  it("custom anchor when provided", () => {
    const r = computeDashboard(new Map([
      ["2025-12", 40_000],
      ["2026-03", 60_000],
      ["2026-06", 90_000],
    ]), 4, "2026-03");
    expect(r.customStart?.startMonth).toBe("2026-03");
    expect(r.customStart?.delta).toBe(30_000);
  });

  it("returns no MoM when only one month present", () => {
    const r = computeDashboard(new Map([["2026-04", 100_000]]), 4);
    expect(r.mom).toBeNull();
  });
});

describe("carryForwardSeries", () => {
  it("fills gaps with the previous value", () => {
    const out = carryForwardSeries(new Map([
      ["2026-01", 100],
      ["2026-04", 250],
    ]));
    expect(out).toEqual([
      { month: "2026-01", total: 100 },
      { month: "2026-02", total: 100 },
      { month: "2026-03", total: 100 },
      { month: "2026-04", total: 250 },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(carryForwardSeries(new Map())).toEqual([]);
  });
});

describe("estimateAnnualSavings", () => {
  it("returns null with fewer than two snapshots", () => {
    expect(estimateAnnualSavings(new Map())).toBeNull();
    expect(estimateAnnualSavings(new Map([["2026-01", 100]]))).toBeNull();
  });

  it("annualises net-worth growth over the available span (< 3 years)", () => {
    // 12 months, +120k → 120k/yr.
    expect(estimateAnnualSavings(new Map([
      ["2025-01", 100_000],
      ["2026-01", 220_000],
    ]))).toBe(120_000);
  });

  it("averages over at most the last three years", () => {
    // 5 years of history; only the last 3 (2023-01 → 2026-01, +300k) count → 100k/yr.
    expect(estimateAnnualSavings(new Map([
      ["2021-01", 0],
      ["2022-01", 50_000],
      ["2023-01", 100_000],
      ["2024-01", 200_000],
      ["2025-01", 300_000],
      ["2026-01", 400_000],
    ]))).toBe(100_000);
  });

  it("clamps dis-saving (net-worth decline) to 0", () => {
    expect(estimateAnnualSavings(new Map([
      ["2025-01", 200_000],
      ["2026-01", 150_000],
    ]))).toBe(0);
  });

  it("handles a partial-year span by annualising", () => {
    // 6 months, +30k → 60k/yr.
    expect(estimateAnnualSavings(new Map([
      ["2025-07", 100_000],
      ["2026-01", 130_000],
    ]))).toBe(60_000);
  });
});

describe("polynomialTrendEstimate", () => {
  it("returns null for empty input", () => {
    expect(polynomialTrendEstimate([], 2026)).toBeNull();
  });

  it("returns the single point's value", () => {
    expect(polynomialTrendEstimate([[2025, 500_000]], 2025)).toBe(500_000);
    // Even when asked at a different x — can't fit a trend from one point.
    expect(polynomialTrendEstimate([[2025, 500_000]], 2030)).toBe(500_000);
  });

  it("fits a line through two points and predicts on it", () => {
    const p: Array<[number, number]> = [[2024, 100], [2025, 200]];
    expect(polynomialTrendEstimate(p, 2025)).toBeCloseTo(200, 6);
    expect(polynomialTrendEstimate(p, 2026)).toBeCloseTo(300, 6); // linear extrapolation
  });

  it("passes exactly through 3 points (quadratic interpolation)", () => {
    // y = x² shifted: at years 2023,2024,2025 → 1,4,9.
    const p: Array<[number, number]> = [[2023, 1], [2024, 4], [2025, 9]];
    expect(polynomialTrendEstimate(p, 2025)).toBeCloseTo(9, 6);
    expect(polynomialTrendEstimate(p, 2026)).toBeCloseTo(16, 6);
  });

  it("smooths an outlier final year with enough points", () => {
    // Flat ~100 for four years, then a spike to 200. The quadratic fit at the
    // latest year should land well below the raw 200.
    const p: Array<[number, number]> = [
      [2021, 100], [2022, 100], [2023, 100], [2024, 100], [2025, 200],
    ];
    const est = polynomialTrendEstimate(p, 2025, 2)!;
    expect(est).toBeLessThan(200);
    expect(est).toBeGreaterThan(100);
  });
});
