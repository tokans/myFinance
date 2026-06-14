/**
 * Time-varying FIRE cash-flow simulation.
 *
 * The steady-state model in `fire.ts` assumes a flat savings rate and a flat
 * retirement spend. This module instead walks the plan **year by year** so that
 * income and expenses can change over a lifetime:
 *
 *   - Income events: marriage (a second income starts), a child (one income
 *     dips during parental leave).
 *   - Dependant costs taper: children stop costing once they become independent;
 *     parents/others stop at their life expectancy; future dependants (parents
 *     who may need support later) switch on at a start age.
 *   - The corpus is sized by **depletion to life expectancy**, not a flat SWR:
 *     the capital needed at retirement is the present value (at the real return)
 *     of the actual, varying net expense stream until the user's life
 *     expectancy. This naturally captures dependants dropping off.
 *
 * Everything is in real (today's) money; returns are real, so no inflation term
 * is needed inside the walk.
 */

import { RISK_PROFILES, type DependantType, type RiskProfile } from "./fire";

/** One cost band over a dependant's own-age range (today's money). Bands may
 * overlap — e.g. a child's general upkeep runs underneath school + college
 * costs — and overlapping bands sum. */
export interface CostSegment {
  /** Dependant age at which this cost starts (inclusive). */
  fromAge: number;
  /** Dependant age at which it ends (exclusive). */
  toAge: number;
  /** Annual cost while active, in today's money. */
  annualCost: number;
}

/** A person the household supports, modelled as one or more cost bands. */
export interface SimDependant {
  type: DependantType;
  /** The dependant's current age (negative = not yet born). Drives band timing. */
  currentAge: number;
  /** Cost bands in the dependant's own-age terms; overlapping bands sum. */
  segments: CostSegment[];
}

/** A life event that shifts household income (and possibly adds a dependant). */
export interface SimEvent {
  kind: "marriage" | "child";
  /** Whole years from today when the event occurs. */
  yearsFromNow: number;
  /** marriage: extra annual income the partner brings (today's money). */
  partnerAnnualIncome?: number;
  /** child: number of years one income is reduced for parental leave. */
  leaveYears?: number;
  /** child: fraction of household income lost during the leave window, [0,1]. */
  leaveIncomeDrop?: number;
}

export interface FireSimInputs {
  currentAge: number;
  /** Plan horizon / death age for the user. */
  userLifeExpectancy: number;
  /** Desired FIRE age (for the headline "what if I retire here"). */
  targetAge: number;
  currentNetWorth: number;
  /** Household gross income today (real). */
  annualIncome: number;
  /** Household savings today (real). Working expense today = income − savings. */
  annualSavings: number;
  /** Retirement base lifestyle today (real), EXCLUDING dependant-specific costs. */
  retirementBaseAnnual: number;
  /** Annual guaranteed income in retirement (pension, rent, etc.), real. */
  annualGuaranteedIncome: number;
  dependants: SimDependant[];
  events: SimEvent[];
  risk: RiskProfile;
}

export interface FireSimYear {
  age: number;
  /** Active dependant cost this year (real). */
  dependantCost: number;
  /** Total expense this year (working or retirement base + dependant cost). */
  expense: number;
  /** Household income this year (0 once retired). */
  income: number;
  /** Net worth at the START of the year. */
  netWorth: number;
  retired: boolean;
}

export interface FireSimPlan {
  realReturn: number;
  /** Sim horizon (last age simulated). */
  endAge: number;
  /** Capital needed at the chosen target age — the headline FIRE number. */
  requiredCorpusAtTarget: number;
  /** Retirement annual expense in the first retirement year, at target age. */
  expenseAtTarget: number;
  /** Peak retirement annual expense across the horizon (dependant-loaded years). */
  peakRetirementExpense: number;
  /** Coast number: amount needed today to coast (no more saving) to age 65. */
  coastNumber: number;
  /** currentNetWorth / requiredCorpusAtTarget, clamped to [0,1]. */
  progress: number;
  /** Age at which net worth first covers the (shrinking) required corpus, at current savings. */
  fireAgeAtCurrentSavings: number | null;
  yearsToFireAtCurrentSavings: number | null;
  /** Extra monthly saving (real) needed to retire by target age. 0 if already on track. */
  requiredAdditionalMonthlySavings: number;
  /** Current monthly saving (annualSavings / 12). */
  currentMonthlySavings: number;
  /** Year-by-year schedule (at current-savings trajectory), for charts/timeline. */
  schedule: FireSimYear[];
}

const TRADITIONAL_RETIREMENT_AGE = 65;

/** Active marginal dependant cost at a given USER age, summing every active band. */
export function dependantCostAtUserAge(
  dependants: SimDependant[],
  currentUserAge: number,
  userAge: number,
): number {
  const elapsed = userAge - currentUserAge;
  let total = 0;
  for (const d of dependants) {
    const depAge = d.currentAge + elapsed;
    for (const s of d.segments) {
      if (depAge >= s.fromAge && depAge < s.toAge) total += s.annualCost;
    }
  }
  return total;
}

/** Household income at a given user age, applying marriage / child-leave events. Working years only. */
function incomeAtUserAge(inp: FireSimInputs, userAge: number): number {
  const elapsed = userAge - inp.currentAge;
  let income = inp.annualIncome;
  for (const ev of inp.events) {
    if (ev.kind === "marriage" && elapsed >= ev.yearsFromNow) {
      income += ev.partnerAnnualIncome ?? inp.annualIncome;
    }
    if (ev.kind === "child") {
      const leave = ev.leaveYears ?? 1;
      const drop = ev.leaveIncomeDrop ?? 0.5;
      if (elapsed >= ev.yearsFromNow && elapsed < ev.yearsFromNow + leave) {
        income *= 1 - drop;
      }
    }
  }
  return Math.max(0, income);
}

/** Retirement expense (real) at a user age: base lifestyle + active dependant costs. */
function retirementExpenseAtUserAge(inp: FireSimInputs, userAge: number): number {
  return (
    inp.retirementBaseAnnual +
    dependantCostAtUserAge(inp.dependants, inp.currentAge, userAge)
  );
}

/** Working expense (real) at a user age: working base + active dependant costs. */
function workingExpenseAtUserAge(
  inp: FireSimInputs,
  workingBase: number,
  userAge: number,
): number {
  return (
    workingBase + dependantCostAtUserAge(inp.dependants, inp.currentAge, userAge)
  );
}

/**
 * Capital needed at retirement age `R`: present value (discounted at the real
 * return) of net retirement expenses from R until the user's life expectancy.
 * Net expense = retirement expense − guaranteed income, floored at 0.
 */
export function requiredCorpusAt(inp: FireSimInputs, R: number, realReturn: number): number {
  const end = inp.userLifeExpectancy;
  let pv = 0;
  for (let age = R; age <= end; age++) {
    const net = Math.max(
      0,
      retirementExpenseAtUserAge(inp, age) - inp.annualGuaranteedIncome,
    );
    pv += net / Math.pow(1 + realReturn, age - R);
  }
  return pv;
}

/**
 * Walk net worth forward at a given extra annual saving, returning the schedule
 * and the first age where NW covers the shrinking required corpus.
 */
function simulate(
  inp: FireSimInputs,
  realReturn: number,
  workingBase: number,
  extraAnnualSaving: number,
  retireAtTargetOnly: boolean,
): { schedule: FireSimYear[]; fireAge: number | null } {
  const schedule: FireSimYear[] = [];
  let nw = inp.currentNetWorth;
  let fireAge: number | null = null;
  let retired = false;

  for (let age = inp.currentAge; age <= inp.userLifeExpectancy; age++) {
    const depCost = dependantCostAtUserAge(inp.dependants, inp.currentAge, age);

    if (!retired) {
      // Has FIRE been reached? Either at the forced target age, or when NW covers the corpus.
      const reached = retireAtTargetOnly
        ? age >= inp.targetAge
        : nw >= requiredCorpusAt(inp, age, realReturn);
      if (reached) {
        retired = true;
        fireAge = age;
      }
    }

    const expense = retired
      ? inp.retirementBaseAnnual + depCost
      : workingBase + depCost;
    const income = retired ? 0 : incomeAtUserAge(inp, age);

    schedule.push({ age, dependantCost: depCost, expense, income, netWorth: nw, retired });

    // Advance net worth to next year.
    if (retired) {
      const net = Math.max(0, expense - inp.annualGuaranteedIncome);
      nw = nw * (1 + realReturn) - net;
    } else {
      const saving = income - expense + extraAnnualSaving;
      nw = nw * (1 + realReturn) + saving;
    }
  }

  return { schedule, fireAge };
}

/** Smallest extra monthly saving so net worth at target age covers the required corpus. */
function solveRequiredExtraMonthly(
  inp: FireSimInputs,
  realReturn: number,
  workingBase: number,
  requiredAtTarget: number,
): number {
  const nwAtTarget = (extraAnnual: number): number => {
    let nw = inp.currentNetWorth;
    for (let age = inp.currentAge; age < inp.targetAge; age++) {
      const expense = workingExpenseAtUserAge(inp, workingBase, age);
      const income = incomeAtUserAge(inp, age);
      nw = nw * (1 + realReturn) + (income - expense + extraAnnual);
    }
    return nw;
  };

  if (nwAtTarget(0) >= requiredAtTarget) return 0;

  // Binary search the extra ANNUAL saving, then convert to monthly.
  let lo = 0;
  let hi = Math.max(requiredAtTarget, inp.annualIncome * 100, 1);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (nwAtTarget(mid) >= requiredAtTarget) hi = mid;
    else lo = mid;
  }
  return hi / 12;
}

export function computeFireSim(inp: FireSimInputs): FireSimPlan {
  const { realReturn } = RISK_PROFILES[inp.risk];
  const endAge = inp.userLifeExpectancy;

  // Working expense today already includes today's dependant costs; back them out
  // to get the dependant-free working base.
  const currentDependantCost = dependantCostAtUserAge(
    inp.dependants,
    inp.currentAge,
    inp.currentAge,
  );
  const workingExpenseToday = Math.max(0, inp.annualIncome - inp.annualSavings);
  const workingBase = Math.max(0, workingExpenseToday - currentDependantCost);

  const requiredCorpusAtTarget = requiredCorpusAt(inp, inp.targetAge, realReturn);
  const expenseAtTarget = retirementExpenseAtUserAge(inp, inp.targetAge);

  let peakRetirementExpense = 0;
  for (let age = inp.targetAge; age <= endAge; age++) {
    peakRetirementExpense = Math.max(peakRetirementExpense, retirementExpenseAtUserAge(inp, age));
  }

  const yearsToTraditional = Math.max(0, TRADITIONAL_RETIREMENT_AGE - inp.currentAge);
  const corpusAt65 = requiredCorpusAt(inp, Math.max(inp.currentAge, TRADITIONAL_RETIREMENT_AGE), realReturn);
  const coastNumber = corpusAt65 / Math.pow(1 + realReturn, yearsToTraditional);

  // Current-savings trajectory: find natural FIRE age + produce the schedule.
  const { schedule, fireAge } = simulate(inp, realReturn, workingBase, 0, false);
  const fireAgeAtCurrentSavings = fireAge;
  const yearsToFireAtCurrentSavings =
    fireAge != null ? fireAge - inp.currentAge : null;

  const requiredAdditionalMonthlySavings = solveRequiredExtraMonthly(
    inp,
    realReturn,
    workingBase,
    requiredCorpusAtTarget,
  );

  const progress =
    requiredCorpusAtTarget > 0
      ? Math.min(1, inp.currentNetWorth / requiredCorpusAtTarget)
      : 1;

  return {
    realReturn,
    endAge,
    requiredCorpusAtTarget,
    expenseAtTarget,
    peakRetirementExpense,
    coastNumber,
    progress,
    fireAgeAtCurrentSavings,
    yearsToFireAtCurrentSavings,
    requiredAdditionalMonthlySavings,
    currentMonthlySavings: inp.annualSavings / 12,
    schedule,
  };
}
