/**
 * Adapter: wizard form → FIRE simulation inputs + a view model.
 *
 * Kept free of React so the household / marriage / child-cost logic is unit
 * testable (see scripts/test-fireform.ts). The page owns the full `FormState`
 * (including UI-only fields); this module only reads the `FireForm` subset.
 */

import {
  classifyFireVariant,
  type DependantType,
  type FireVariant,
  type RiskProfile,
} from "./fire";
import {
  computeFireSim,
  dependantCostAtUserAge,
  type CostSegment,
  type FireSimInputs,
  type FireSimPlan,
  type SimDependant,
  type SimEvent,
} from "./fireSim";
import { locationCostFactor } from "./locationCost";
import { type CostTier } from "../lib/cityCost";

/** Whether the household rents or owns its home in retirement. */
export type HousingChoice = "rent" | "own";

export type HouseholdKind =
  | "single_income_no_dep"
  | "double_income_no_dep"
  | "single_income_dep"
  | "double_income_dep";

/** A goal tagged so the simulation reads its date as a modelled life event. */
export type GoalKind = "marriage" | "child";

/** One dependant the household supports. Cost windows derive from the global
 * assumptions in the form (kid independence, life expectancy). */
export interface DependantDraft {
  id: string;
  type: DependantType;
  /** Dependant's current age. */
  age: number;
  /** Support is a future possibility (parents/in-laws not yet dependent). */
  future: boolean;
  /**
   * Calendar year support is expected to begin. Only consulted for a *future*
   * dependant who is already at/past {@link FUTURE_PARENT_START_DEFAULT} — there
   * the default "switches on at 75" assumption is already in the past, so the
   * user is asked when support actually starts. Null/undefined falls back to the
   * default switch age.
   */
  supportFromYear?: number | null;
}

// First-pass assumption defaults (stated to the user, refinable in pass 2).
export const USER_LIFE_EXPECTANCY_DEFAULT = 80;
export const DEPENDANT_LIFE_EXP_DEFAULT = 80;
export const KID_INDEPENDENCE_DEFAULT = 25;
export const FUTURE_PARENT_START_DEFAULT = 75;
export const CHILD_LEAVE_YEARS_DEFAULT = 1;
export const CHILD_LEAVE_DROP_DEFAULT = 0.5;
export const CHILD_SCHOOL_START_DEFAULT = 4;
export const CHILD_SCHOOL_END_DEFAULT = 18;

/**
 * Rate used to convert a locked retirement corpus (NPS/EPF/PPF) into an annual
 * guaranteed-income estimate for the prefill — the 4% safe-withdrawal
 * convention. The corpus is then excluded from the FIRE drawdown net worth so
 * the same money isn't counted twice. Editable by the user afterwards.
 */
export const RETIREMENT_INCOME_WITHDRAWAL_RATE = 0.04;

/** Which household variants currently support dependants. */
export const HOUSEHOLD_HAS_DEPENDANTS: Record<HouseholdKind, boolean> = {
  single_income_no_dep: false,
  double_income_no_dep: false,
  single_income_dep: true,
  double_income_dep: true,
};

/** Single-income households can gain a second income later (e.g. via marriage). */
export function isSingleIncome(household: HouseholdKind): boolean {
  return household === "single_income_no_dep" || household === "single_income_dep";
}

/** Goal fields the adapter reads (NewGoalDraft is structurally assignable). */
export interface GoalLike {
  kind?: GoalKind;
  target_date: string;
}

/** The subset of the wizard form the simulation needs. */
export interface FireForm {
  household: HouseholdKind;
  currentAge: number;
  targetAge: number;
  currentNetWorth: number;
  annualIncome: number;
  annualSavings: number;
  monthlySpendRetirement: number;
  retirementSpendIncludesDependants: boolean;
  dependantMonthlyCost: number;
  annualGuaranteedIncome: number;
  risk: RiskProfile;
  dependants: DependantDraft[];
  newGoals: readonly GoalLike[];
  // Future second income (single-income households only).
  expectSecondIncome: boolean;
  secondIncomeAtAge: number;
  // Location & cost of living. Home (residence) + retirement location drive a
  // cost-of-living / PPP factor on the non-rent lifestyle spend. An empty
  // retirementCountry means "undecided" → factor 1 (no relocation modelled).
  country: string;
  city: string;
  retirementCountry: string;
  retirementCity: string;
  homeTierOverride: CostTier | null;
  retirementTierOverride: CostTier | null;
  /** Manual cost-of-living factor override (e.g. 70 → 0.70). null = auto. */
  manualLocationFactorPct: number | null;
  // Housing (pass-2 refine). The location factor never scales rent/ownership.
  housingIncludesRent: boolean;
  housingChoice: HousingChoice;
  monthlyRent: number;
  monthlySocietyFees: number;
  annualPropertyTax: number;
  /** Inflation-proof rental income from a second property (real, today's money). */
  monthlyRentalIncome: number;
  // Assumptions (pass-1 defaults; editable in the refine panel).
  userLifeExpectancy: number;
  childIndependenceAge: number;
  dependantLifeExpectancy: number;
  marriagePartnerIncome: number | null;
  childLeaveYears: number;
  childLeaveDrop: number;
  childUpkeepMonthly: number;
  childSchoolMonthly: number;
  childCollegeAnnual: number;
  childSchoolStartAge: number;
  childSchoolEndAge: number;
}

export interface SensitivityRow {
  scenario: string;
  realReturn: number;
  corpus: number;
  fireAge: number | null;
}

export interface FireView {
  sim: FireSimPlan;
  inputs: FireSimInputs;
  variant: FireVariant;
  sensitivity: SensitivityRow[];
}

/** Phased cost bands for one child, in the child's own-age terms (today's money). */
export function childCostSegments(form: FireForm): CostSegment[] {
  const segs: CostSegment[] = [];
  const upkeep = Math.max(0, form.childUpkeepMonthly) * 12;
  const school = Math.max(0, form.childSchoolMonthly) * 12;
  const college = Math.max(0, form.childCollegeAnnual);
  const independence = form.childIndependenceAge;
  const schoolEnd = Math.min(form.childSchoolEndAge, independence);
  if (upkeep > 0) segs.push({ fromAge: 0, toAge: independence, annualCost: upkeep });
  if (school > 0) segs.push({ fromAge: form.childSchoolStartAge, toAge: schoolEnd, annualCost: school });
  if (college > 0 && schoolEnd < independence) {
    segs.push({ fromAge: schoolEnd, toAge: independence, annualCost: college });
  }
  return segs;
}

/** Whether a child event/dependant exists (current child, or a tagged child goal). */
export function formHasChild(form: FireForm): boolean {
  return (
    form.dependants.some((d) => d.type === "children") ||
    form.newGoals.some((g) => g.kind === "child" && !!g.target_date)
  );
}

/** Build the year-by-year simulation inputs from the form. */
export function buildFireInputs(
  form: FireForm,
  nowYear: number = new Date().getFullYear(),
): FireSimInputs {
  // Non-child dependant costs: the single "support cost" figure split across the
  // current non-child dependants. Children use the phased model below.
  const nonChild = form.dependants.filter((d) => d.type !== "children");
  const nonChildCurrent = nonChild.filter((d) => !d.future);
  const totalDepAnnual = Math.max(0, form.dependantMonthlyCost) * 12;
  const splitDenom = nonChildCurrent.length > 0 ? nonChildCurrent.length : (nonChild.length || 1);
  const perDepCost = totalDepAnnual / splitDenom;

  const childSegs = childCostSegments(form);

  const simDependants: SimDependant[] = form.dependants.map((d) => {
    if (d.type === "children") {
      return { type: d.type, currentAge: d.age, segments: childSegs };
    }
    // Future dependants switch on at the default age (75). But if one is already
    // at/past that age, "75" is in the past — honour the user-supplied switch
    // year instead, converted to the dependant's age at that year.
    const startAge = !d.future
      ? d.age
      : d.age >= FUTURE_PARENT_START_DEFAULT && d.supportFromYear != null
        ? Math.max(d.age, d.age + (d.supportFromYear - nowYear))
        : Math.max(FUTURE_PARENT_START_DEFAULT, d.age);
    const endAge = Math.max(startAge + 1, form.dependantLifeExpectancy);
    return {
      type: d.type,
      currentAge: d.age,
      segments: [{ fromAge: startAge, toAge: endAge, annualCost: perDepCost }],
    };
  });

  const events: SimEvent[] = [];
  const eventDependants: SimDependant[] = [];

  // Future second income (marriage) — single-income households only, captured
  // explicitly in the life-stage step (not via a goal).
  if (isSingleIncome(form.household) && form.expectSecondIncome) {
    events.push({
      kind: "marriage",
      yearsFromNow: Math.max(0, form.secondIncomeAtAge - form.currentAge),
      partnerAnnualIncome: form.marriagePartnerIncome ?? form.annualIncome,
    });
  }

  // A future child (from a tagged child goal): income dip during leave + a child
  // dependant with the phased cost model, born at the goal's year.
  for (const g of form.newGoals) {
    if (g.kind !== "child" || !g.target_date) continue;
    const yr = Number(g.target_date.slice(0, 4));
    if (!yr) continue;
    const yearsFromNow = Math.max(0, yr - nowYear);
    events.push({
      kind: "child",
      yearsFromNow,
      leaveYears: form.childLeaveYears,
      leaveIncomeDrop: form.childLeaveDrop,
    });
    eventDependants.push({
      type: "children",
      currentAge: -yearsFromNow,
      segments: childSegs,
    });
  }

  const retirementSpendAnnual = Math.max(0, form.monthlySpendRetirement) * 12;

  // Where you retire scales the non-rent lifestyle (PPP across currencies, or
  // city cost-of-living within a currency). Empty retirementCountry → factor 1.
  const { factor: locFactor } = locationCostFactor({
    homeCountry: form.country,
    homeCity: form.city,
    retirementCountry: form.retirementCountry,
    retirementCity: form.retirementCity,
    retirementUndecided: !form.retirementCountry,
    manualLocationFactorPct: form.manualLocationFactorPct,
    homeTierOverride: form.homeTierOverride,
    retirementTierOverride: form.retirementTierOverride,
  });

  const monthlyRentAnnual = Math.max(0, form.monthlyRent) * 12;
  // Strip rent out of the entered spend only when it's embedded AND we rent.
  const embeddedRentAnnual =
    form.housingIncludesRent && form.housingChoice === "rent" ? monthlyRentAnnual : 0;
  // Dependant cost active *today* (children's current-age bands + non-child costs).
  const currentDepCostNow = dependantCostAtUserAge(simDependants, form.currentAge, form.currentAge);
  // Pull rent AND today's dependant cost out of the entered spend first, so the
  // location factor scales only the user's *own* lifestyle. Dependant streams are
  // re-added by the sim at their own (location-independent) cost, and rent /
  // ownership costs are added back unscaled (already retirement-location figures).
  const embeddedDepAnnual = form.retirementSpendIncludesDependants ? currentDepCostNow : 0;
  const ownLifestyleAnnual = Math.max(0, retirementSpendAnnual - embeddedRentAnnual - embeddedDepAnnual);
  const scaledLifestyleAnnual = ownLifestyleAnnual * locFactor;
  const housingAnnual =
    form.housingChoice === "own"
      ? Math.max(0, form.monthlySocietyFees) * 12 + Math.max(0, form.annualPropertyTax)
      : monthlyRentAnnual;
  const retirementBaseAnnual = scaledLifestyleAnnual + housingAnnual;

  // Second-house rent is real, inflation-proof income → folds into guaranteed income.
  const annualGuaranteedIncome =
    Math.max(0, form.annualGuaranteedIncome) + Math.max(0, form.monthlyRentalIncome) * 12;

  return {
    currentAge: form.currentAge,
    userLifeExpectancy: Math.max(form.userLifeExpectancy, form.targetAge + 1),
    targetAge: form.targetAge,
    currentNetWorth: form.currentNetWorth,
    annualIncome: form.annualIncome,
    annualSavings: form.annualSavings,
    retirementBaseAnnual,
    annualGuaranteedIncome,
    dependants: [...simDependants, ...eventDependants],
    events,
    risk: form.risk,
  };
}

/** Build the full results view: plan + variant + a 3-scenario sensitivity. */
export function buildFireView(
  form: FireForm,
  nowYear: number = new Date().getFullYear(),
): FireView {
  const inputs = buildFireInputs(form, nowYear);
  const sim = computeFireSim(inputs);
  const variant = classifyFireVariant(sim.requiredCorpusAtTarget, form.currentNetWorth, sim.coastNumber);

  const scenarios: { scenario: string; risk: RiskProfile }[] = [
    { scenario: "Conservative", risk: "conservative" },
    { scenario: "Base", risk: form.risk },
    { scenario: "Optimistic", risk: "growth" },
  ];
  const sensitivity: SensitivityRow[] = scenarios.map(({ scenario, risk }) => {
    const s = computeFireSim({ ...inputs, risk });
    return {
      scenario,
      realReturn: s.realReturn,
      corpus: s.requiredCorpusAtTarget,
      fireAge: s.fireAgeAtCurrentSavings,
    };
  });

  return { sim, inputs, variant, sensitivity };
}
