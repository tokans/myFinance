import { compareMonths, diffMonths, type Month } from "./calc";
import type { Goal } from "@/db/goals";

export interface GoalProgress {
  goal: Goal;
  baselineValue: number;
  currentValue: number;
  progressPct: number;
  remaining: number;
  trailing3mRate: number | null;
  monthsToGoal: number | null;
  projectedMonth: Month | null;
  /** Whether the trailing rate is non-positive, meaning ETA can't be computed. */
  stagnant: boolean;
}

/**
 * Compute progress for a single goal.
 * - baseline = total at goal.baseline_month (or 0 if not set)
 * - current  = total at latest month
 * - progress = (current - baseline) / (target - baseline), clamped to [0, 1]
 * - trailing rate = avg monthly delta over the last 3 months of data
 */
export function computeGoalProgress(
  goal: Goal,
  totalsByMonth: Map<Month, number>,
): GoalProgress {
  const months = Array.from(totalsByMonth.keys()).sort(compareMonths);
  const currentValue = months.length ? totalsByMonth.get(months[months.length - 1]) ?? 0 : 0;
  const baselineValue = goal.baseline_month
    ? totalsByMonth.get(goal.baseline_month) ?? 0
    : 0;
  const span = goal.target_amount - baselineValue;
  const gained = currentValue - baselineValue;
  const progressPct = span === 0 ? 1 : Math.max(0, Math.min(1, gained / span));
  const remaining = Math.max(0, goal.target_amount - currentValue);

  let trailing3mRate: number | null = null;
  if (months.length >= 2) {
    const lastN = months.slice(-4); // up to 4 anchors for 3 monthly deltas
    const deltas: number[] = [];
    for (let i = 1; i < lastN.length; i++) {
      deltas.push((totalsByMonth.get(lastN[i]) ?? 0) - (totalsByMonth.get(lastN[i - 1]) ?? 0));
    }
    if (deltas.length > 0) {
      trailing3mRate = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    }
  }

  let monthsToGoal: number | null = null;
  let projectedMonth: Month | null = null;
  const stagnant = trailing3mRate == null || trailing3mRate <= 0;
  if (!stagnant && remaining > 0 && trailing3mRate != null && trailing3mRate > 0) {
    monthsToGoal = Math.ceil(remaining / trailing3mRate);
    if (months.length > 0) {
      const latest = months[months.length - 1];
      projectedMonth = addMonthsLocal(latest, monthsToGoal);
    }
  } else if (remaining === 0) {
    monthsToGoal = 0;
  }

  return {
    goal,
    baselineValue,
    currentValue,
    progressPct,
    remaining,
    trailing3mRate,
    monthsToGoal,
    projectedMonth,
    stagnant,
  };
}

function addMonthsLocal(m: Month, delta: number): Month {
  const [yStr, mStr] = m.split("-");
  const total = Number(yStr) * 12 + (Number(mStr) - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Is this goal "behind" its linear trajectory toward target_date? */
export function isBehindSchedule(p: GoalProgress): boolean {
  if (!p.goal.target_date) return false;
  if (!p.goal.baseline_month) return p.remaining > 0;
  const targetMonth = p.goal.target_date.slice(0, 7);
  const totalMonths = diffMonths(targetMonth, p.goal.baseline_month);
  if (totalMonths <= 0) return p.remaining > 0;
  const expectedPct = Math.min(1, Math.max(0, 1 - p.remaining / (p.goal.target_amount - p.baselineValue || 1)));
  return p.progressPct < expectedPct - 0.05;
}
