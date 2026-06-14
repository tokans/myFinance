import { describe, it, expect } from "vitest";
import { computeGoalProgress, isBehindSchedule } from "./goals";
import type { Goal } from "@/db/goals";

const baseGoal: Goal = {
  id: 1,
  name: "Down payment",
  target_amount: 1_000_000,
  target_date: null,
  baseline_month: null,
  account_filter: null,
  category: null,
  created_at: "2026-01-01",
  archived_at: null,
};

describe("computeGoalProgress", () => {
  it("clamps progress to [0, 1] and reports remaining", () => {
    const totals = new Map([["2026-01", 200_000], ["2026-04", 600_000]]);
    const p = computeGoalProgress(baseGoal, totals);
    expect(p.currentValue).toBe(600_000);
    expect(p.baselineValue).toBe(0); // no baseline_month
    expect(p.progressPct).toBeCloseTo(0.6);
    expect(p.remaining).toBe(400_000);
  });

  it("subtracts baseline_month when set", () => {
    const totals = new Map([["2026-01", 200_000], ["2026-04", 600_000]]);
    const p = computeGoalProgress(
      { ...baseGoal, baseline_month: "2026-01" },
      totals,
    );
    expect(p.baselineValue).toBe(200_000);
    // span = 800k, gained = 400k → 0.5
    expect(p.progressPct).toBeCloseTo(0.5);
  });

  it("computes trailing rate over up to 3 monthly deltas", () => {
    const totals = new Map([
      ["2026-01", 100_000],
      ["2026-02", 200_000],
      ["2026-03", 300_000],
      ["2026-04", 400_000],
    ]);
    const p = computeGoalProgress(baseGoal, totals);
    // Last 4 anchors → 3 deltas, all 100k.
    expect(p.trailing3mRate).toBe(100_000);
    expect(p.stagnant).toBe(false);
    expect(p.monthsToGoal).toBe(Math.ceil(600_000 / 100_000)); // 6
    expect(p.projectedMonth).toBe("2026-10");
  });

  it("marks stagnant when trailing rate is non-positive", () => {
    const totals = new Map([
      ["2026-01", 100_000],
      ["2026-02", 90_000],
      ["2026-03", 85_000],
    ]);
    const p = computeGoalProgress(baseGoal, totals);
    expect(p.stagnant).toBe(true);
    expect(p.monthsToGoal).toBeNull();
    expect(p.projectedMonth).toBeNull();
  });

  it("reports complete when remaining is zero", () => {
    const totals = new Map([["2026-04", 1_000_000]]);
    const p = computeGoalProgress(baseGoal, totals);
    expect(p.remaining).toBe(0);
    expect(p.monthsToGoal).toBe(0);
  });
});

describe("isBehindSchedule", () => {
  it("ignores when no target_date is set", () => {
    const totals = new Map([["2026-04", 100_000]]);
    const p = computeGoalProgress(baseGoal, totals);
    expect(isBehindSchedule(p)).toBe(false);
  });

  it("flags behind when no baseline and remaining > 0", () => {
    const totals = new Map([["2026-04", 100_000]]);
    const p = computeGoalProgress(
      { ...baseGoal, target_date: "2027-01-31" },
      totals,
    );
    expect(isBehindSchedule(p)).toBe(true);
  });
});
