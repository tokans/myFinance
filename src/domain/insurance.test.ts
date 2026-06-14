import { describe, expect, it } from "vitest";
import {
  assessCoverage, coverageGap, coveredFor, recommendedTermCover,
} from "./insurance";

describe("recommendedTermCover", () => {
  it("applies the multiplier, default 12x", () => {
    expect(recommendedTermCover(1_000_000)).toBe(12_000_000);
    expect(recommendedTermCover(1_000_000, 15)).toBe(15_000_000);
    expect(recommendedTermCover(0)).toBe(0);
    expect(recommendedTermCover(-5)).toBe(0);
  });
});

describe("coverageGap", () => {
  it("is the shortfall, clamped at 0", () => {
    expect(coverageGap(100, 60)).toBe(40);
    expect(coverageGap(100, 120)).toBe(0);
  });
});

describe("coveredFor", () => {
  it("sums sum_assured for a kind", () => {
    const policies = [
      { kind: "term", sum_assured: 5_000_000 },
      { kind: "term", sum_assured: 2_000_000 },
      { kind: "health", sum_assured: 1_000_000 },
    ];
    expect(coveredFor(policies, "term")).toBe(7_000_000);
    expect(coveredFor(policies, "health")).toBe(1_000_000);
    expect(coveredFor(policies, "accident")).toBe(0);
  });
});

describe("assessCoverage", () => {
  it("flags gaps and adequacy per kind, skipping kinds without a target", () => {
    const policies = [
      { kind: "term", sum_assured: 5_000_000 },
      { kind: "health", sum_assured: 1_500_000 },
    ];
    const lines = assessCoverage(policies, {
      annualIncome: 1_000_000, // term target 12,000,000
      healthTarget: 1_000_000,
      // no accident/CI/loan targets → omitted
    });
    const term = lines.find((l) => l.kind === "term")!;
    expect(term.target).toBe(12_000_000);
    expect(term.covered).toBe(5_000_000);
    expect(term.gap).toBe(7_000_000);
    expect(term.adequate).toBe(false);

    const health = lines.find((l) => l.kind === "health")!;
    expect(health.adequate).toBe(true);
    expect(health.gap).toBe(0);

    expect(lines.find((l) => l.kind === "accident")).toBeUndefined();
  });
});
