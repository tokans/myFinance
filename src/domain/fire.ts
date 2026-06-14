/**
 * FIRE (Financial Independence, Retire Early) calculations.
 * Pure functions, no DB, no React.
 *
 * Methodology follows fire-calculator.skill: corpus from inflation-adjusted
 * annual expenses ÷ SWR, time-to-FIRE from annuity FV inversion, monthly PMT
 * from standard finance formula. All math runs in real (inflation-adjusted)
 * terms — present-day money in, present-day money out — except where the
 * inflated retirement-year corpus is reported.
 */

export type RiskProfile = "conservative" | "moderate" | "growth" | "aggressive";

export interface RiskAssumption {
  label: string;
  realReturn: number;
  swr: number;
}

export const RISK_PROFILES: Record<RiskProfile, RiskAssumption> = {
  conservative: { label: "Very conservative", realReturn: 0.03, swr: 0.035 },
  moderate: { label: "Moderate", realReturn: 0.05, swr: 0.04 },
  growth: { label: "Growth-oriented", realReturn: 0.07, swr: 0.045 },
  aggressive: { label: "Aggressive", realReturn: 0.085, swr: 0.045 },
};

export const DEFAULT_INFLATION = 0.03;

export type DependantType =
  | "children"
  | "spouse_partner"
  | "parents"
  | "siblings"
  | "other";

/** Inflate today's annual expenses to the target retirement year. */
export function inflateAnnualExpenses(
  annualExpensesToday: number,
  years: number,
  inflation = DEFAULT_INFLATION,
): number {
  return annualExpensesToday * Math.pow(1 + inflation, Math.max(0, years));
}

/** Corpus = (inflated AE − guaranteed income) ÷ SWR. */
export function calcCorpus(
  annualExpensesToday: number,
  years: number,
  swr: number,
  annualGuaranteedIncome = 0,
  inflation = DEFAULT_INFLATION,
): number {
  const aeFuture = inflateAnnualExpenses(annualExpensesToday, years, inflation);
  const net = Math.max(0, aeFuture - annualGuaranteedIncome);
  return net / swr;
}

/**
 * Years to reach target corpus from current net worth, given annual savings
 * and real return r. Derived by inverting the standard annuity FV:
 *   FV = (PV + S/r)(1+r)^n − S/r
 *   ⇒ n = ln((FV + S/r) / (PV + S/r)) / ln(1+r)
 *
 * Returns null when the goal is mathematically unreachable (e.g. zero
 * savings + zero growth + PV < FV) or already met.
 */
export function calcYearsToFire(
  target: number,
  currentNetWorth: number,
  annualSavings: number,
  realReturn: number,
): number | null {
  if (currentNetWorth >= target) return 0;
  if (realReturn === 0) {
    if (annualSavings <= 0) return null;
    return (target - currentNetWorth) / annualSavings;
  }
  const offset = annualSavings / realReturn;
  const numerator = target + offset;
  const denominator = currentNetWorth + offset;
  if (denominator <= 0 || numerator <= 0) return null;
  const n = Math.log(numerator / denominator) / Math.log(1 + realReturn);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Monthly PMT to hit `target` in `years` starting from `currentNetWorth`,
 * compounding at annual `realReturn`. Returns 0 if already past target.
 */
export function calcRequiredMonthlySavings(
  target: number,
  currentNetWorth: number,
  realReturn: number,
  years: number,
): number {
  if (years <= 0) return 0;
  const rm = realReturn / 12;
  const nm = years * 12;
  if (rm === 0) {
    return Math.max(0, (target - currentNetWorth) / nm);
  }
  const growth = Math.pow(1 + rm, nm);
  const pmt = ((target - currentNetWorth * growth) * rm) / (growth - 1);
  return Math.max(0, pmt);
}

/**
 * Coast FIRE: amount needed TODAY so compound growth alone (no further
 * contributions) reaches the corpus by `traditionalRetirementAge`.
 */
export function calcCoastNumber(
  target: number,
  realReturn: number,
  yearsUntilTraditional: number,
): number {
  if (yearsUntilTraditional <= 0) return target;
  return target / Math.pow(1 + realReturn, yearsUntilTraditional);
}

export type FireVariant = "lean" | "regular" | "coast" | "fat";

/**
 * Classify the user's FIRE flavor for the headline. Coast wins if the user
 * is already at/past their coast number; otherwise lean/regular/fat by
 * corpus size, matching the bands in the skill spec.
 */
export function classifyFireVariant(
  corpus: number,
  currentNetWorth: number,
  coastNumber: number,
): FireVariant {
  if (currentNetWorth >= coastNumber && currentNetWorth < corpus) return "coast";
  if (corpus < 500_000) return "lean";
  if (corpus > 2_500_000) return "fat";
  return "regular";
}

export const FIRE_VARIANT_LABEL: Record<FireVariant, string> = {
  lean: "Lean FIRE",
  regular: "Regular FIRE",
  coast: "Coast FIRE",
  fat: "Fat FIRE",
};

export const FIRE_VARIANT_BLURB: Record<FireVariant, string> = {
  lean: "Minimal-spend retirement — maximum freedom on a tight budget.",
  regular: "Comfortable retirement on the classic 4% rule.",
  coast:
    "You're already at the coast point — compound growth alone gets you to traditional retirement, even with no further contributions.",
  fat: "Luxury retirement — travel, dining, no compromises.",
};

export interface FireInputs {
  /** Today */
  currentAge: number;
  /** Desired FIRE age */
  targetAge: number;
  currentNetWorth: number;
  /** Annual savings (today's money) */
  annualSavings: number;
  /** Monthly household spend in retirement, today's money */
  monthlySpendRetirement: number;
  /** Annual guaranteed income (pension, SS, rent) in retirement, today's money */
  annualGuaranteedIncome: number;
  risk: RiskProfile;
  inflation?: number;
}

export interface FireSensitivityRow {
  scenario: "Conservative" | "Base" | "Optimistic";
  realReturn: number;
  swr: number;
  inflation: number;
  corpus: number;
  yearsToFire: number | null;
  fireAge: number | null;
}

export interface FirePlan {
  /** Years between now and chosen FIRE age (≥ 0). */
  horizon: number;
  /** Annual expenses today (monthly × 12). */
  annualExpensesToday: number;
  /** Inflated annual expenses at retirement year. */
  annualExpensesAtRetirement: number;
  /** Net annual expenses after subtracting guaranteed income. */
  netAnnualExpenses: number;
  swr: number;
  realReturn: number;
  inflation: number;
  /** Corpus needed at retirement year. */
  corpus: number;
  /** Coast FIRE number (needed today to coast to age 65 untouched). */
  coastNumber: number;
  /** How far current NW gets you toward the corpus, in [0,1]. */
  progress: number;
  /** Time math at the user's actual savings rate. */
  yearsAtCurrentSavings: number | null;
  fireAgeAtCurrentSavings: number | null;
  /** Required monthly PMT to hit corpus by chosen targetAge. */
  requiredMonthlySavings: number;
  /** Current monthly savings (annualSavings / 12). */
  currentMonthlySavings: number;
  /** PMT gap (required − current); positive = need to save more. */
  monthlySavingsGap: number;
  variant: FireVariant;
  sensitivity: FireSensitivityRow[];
}

export function computeFirePlan(inputs: FireInputs): FirePlan {
  const inflation = inputs.inflation ?? DEFAULT_INFLATION;
  const horizon = Math.max(0, inputs.targetAge - inputs.currentAge);
  const { realReturn, swr } = RISK_PROFILES[inputs.risk];

  const annualExpensesToday = Math.max(0, inputs.monthlySpendRetirement) * 12;
  const annualExpensesAtRetirement = inflateAnnualExpenses(
    annualExpensesToday,
    horizon,
    inflation,
  );
  const netAnnualExpenses = Math.max(
    0,
    annualExpensesAtRetirement - Math.max(0, inputs.annualGuaranteedIncome),
  );
  const corpus = swr > 0 ? netAnnualExpenses / swr : 0;

  const yearsUntilTraditional = Math.max(0, 65 - inputs.currentAge);
  const coastNumber = calcCoastNumber(corpus, realReturn, yearsUntilTraditional);

  const yearsAtCurrentSavings = calcYearsToFire(
    corpus,
    inputs.currentNetWorth,
    inputs.annualSavings,
    realReturn,
  );
  const fireAgeAtCurrentSavings =
    yearsAtCurrentSavings != null
      ? inputs.currentAge + yearsAtCurrentSavings
      : null;

  const requiredMonthlySavings = calcRequiredMonthlySavings(
    corpus,
    inputs.currentNetWorth,
    realReturn,
    horizon,
  );
  const currentMonthlySavings = inputs.annualSavings / 12;
  const monthlySavingsGap = requiredMonthlySavings - currentMonthlySavings;

  const variant = classifyFireVariant(corpus, inputs.currentNetWorth, coastNumber);
  const progress = corpus > 0 ? Math.min(1, inputs.currentNetWorth / corpus) : 1;

  const sensitivity: FireSensitivityRow[] = (
    [
      { scenario: "Conservative", realReturn: 0.04, swr: 0.035, inflation: 0.04 },
      { scenario: "Base", realReturn, swr, inflation },
      { scenario: "Optimistic", realReturn: 0.08, swr: 0.045, inflation: 0.02 },
    ] as const
  ).map(({ scenario, realReturn: rr, swr: s, inflation: inf }) => {
    const ae = inflateAnnualExpenses(annualExpensesToday, horizon, inf);
    const net = Math.max(0, ae - Math.max(0, inputs.annualGuaranteedIncome));
    const c = s > 0 ? net / s : 0;
    const y = calcYearsToFire(c, inputs.currentNetWorth, inputs.annualSavings, rr);
    return {
      scenario,
      realReturn: rr,
      swr: s,
      inflation: inf,
      corpus: c,
      yearsToFire: y,
      fireAge: y != null ? inputs.currentAge + y : null,
    };
  });

  return {
    horizon,
    annualExpensesToday,
    annualExpensesAtRetirement,
    netAnnualExpenses,
    swr,
    realReturn,
    inflation,
    corpus,
    coastNumber,
    progress,
    yearsAtCurrentSavings,
    fireAgeAtCurrentSavings,
    requiredMonthlySavings,
    currentMonthlySavings,
    monthlySavingsGap,
    variant,
    sensitivity,
  };
}

export interface LifeGoalCategory {
  key: string;
  label: string;
}

export const LIFE_GOAL_CATEGORIES: LifeGoalCategory[] = [
  { key: "travel", label: "Travel extensively" },
  { key: "home", label: "Buy a home" },
  { key: "business", label: "Start a business" },
  { key: "creative", label: "Pursue creative work" },
  { key: "parents", label: "Care for aging parents" },
  { key: "kids", label: "Raise children well" },
  { key: "giving", label: "Give to causes" },
  { key: "learning", label: "Learn / study" },
  { key: "abroad", label: "Live abroad" },
  { key: "legacy", label: "Build a legacy" },
  { key: "health", label: "Health & longevity" },
  { key: "spiritual", label: "Spiritual / personal growth" },
];

export const MAJOR_EXPENSE_OPTIONS: LifeGoalCategory[] = [
  { key: "home_purchase", label: "Home purchase" },
  { key: "child_education", label: "Child's education" },
  { key: "business", label: "Business investment" },
  { key: "medical", label: "Major medical" },
  { key: "wedding", label: "Wedding / family event" },
];
