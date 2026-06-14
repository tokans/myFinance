import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Download, FileText, Flame, Plus, Save, Sparkles, Target, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FiniteSetInput } from "@/components/forms/FiniteSetInput";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/environment";
import { DEFAULT_COUNTRY, currencyForCountry } from "@/lib/countryCurrency";
import { cityCostIndex, cityCostTier, COST_TIER_LABEL, type CostTier } from "@/lib/cityCost";
import { locationCostFactor, suggestedMonthlyRent } from "@/domain/locationCost";
import { buildFireReportHtml, printHtmlAsPdf } from "@/lib/fireReport";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney } from "@/lib/format";
import { totalsByMonth, balanceForTypesLatestMonth } from "@/db/aggregates";
import { estimateAnnualSavings, polynomialTrendEstimate } from "@/domain/calc";
import { RETIREMENT_INCOME_TYPES } from "@/lib/accountTypes";
import { createGoal, listGoals, type Goal } from "@/db/goals";
import { listTaxYears, getAssessment } from "@/db/tax";
import {
  FIRE_VARIANT_BLURB,
  FIRE_VARIANT_LABEL,
  LIFE_GOAL_CATEGORIES,
  MAJOR_EXPENSE_OPTIONS,
  RISK_PROFILES,
  type DependantType,
  type RiskProfile,
} from "@/domain/fire";
import {
  buildFireView,
  CHILD_LEAVE_DROP_DEFAULT,
  CHILD_LEAVE_YEARS_DEFAULT,
  CHILD_SCHOOL_END_DEFAULT,
  CHILD_SCHOOL_START_DEFAULT,
  DEPENDANT_LIFE_EXP_DEFAULT,
  formHasChild,
  FUTURE_PARENT_START_DEFAULT,
  HOUSEHOLD_HAS_DEPENDANTS,
  RETIREMENT_INCOME_WITHDRAWAL_RATE,
  isSingleIncome,
  KID_INDEPENDENCE_DEFAULT,
  USER_LIFE_EXPECTANCY_DEFAULT,
  type DependantDraft,
  type FireView,
  type GoalKind,
  type HouseholdKind,
  type HousingChoice,
} from "@/domain/fireForm";

type Lifestyle = "lean" | "moderate" | "comfortable" | "fat";
type RetirementLocation = "same_city" | "same_country_lower" | "abroad_lower" | "abroad_similar" | "undecided";
type SemiRetirement = "love" | "maybe" | "passive" | "clean_break";

interface NewGoalDraft {
  name: string;
  target_amount: number;
  target_date: string;
  /** Set when added from a household suggestion — drives the income-change model. */
  kind?: GoalKind;
}

interface FormState {
  // Group A
  currentAge: number;
  /** ISO country code of residence (master `country`). Contextual only. */
  country: string;
  /** City of residence (master `city`, scoped to `country`). Contextual only. */
  city: string;
  household: HouseholdKind;
  /** Individual dependants (only for "with dependants" variants). */
  dependants: DependantDraft[];
  /** Single-income only: expect a second income later (e.g. via marriage). */
  expectSecondIncome: boolean;
  /** Your age when that second income starts. */
  secondIncomeAtAge: number;
  // Group B
  annualIncome: number;
  currentNetWorth: number;
  annualSavings: number;
  // Group C
  targetAge: number;
  retirementLocation: RetirementLocation;
  lifestyle: Lifestyle;
  /** ISO country code of the planned retirement location (empty = undecided). */
  retirementCountry: string;
  /** City of the planned retirement location (scoped to retirementCountry). */
  retirementCity: string;
  /** Manual low/med/high override for the current city (null = use detected). */
  homeTierOverride: CostTier | null;
  /** Manual low/med/high override for the retirement city (null = use detected). */
  retirementTierOverride: CostTier | null;
  /** Manual cost-of-living factor override, e.g. 70 → 0.70 (null = auto). */
  manualLocationFactorPct: number | null;
  // Group D
  monthlySpendRetirement: number;
  /** Whether the retirement spend above already covers dependant costs. */
  retirementSpendIncludesDependants: boolean;
  /** Total monthly cost (today) attributable to dependants. */
  dependantMonthlyCost: number;
  // Housing (pass-2 refine). Rent/ownership are retirement-location figures and
  // are never scaled by the cost-of-living factor.
  /** Whether the monthly spend above already includes rent. */
  housingIncludesRent: boolean;
  /** Rent or own the home in retirement. */
  housingChoice: HousingChoice;
  monthlyRent: number;
  monthlySocietyFees: number;
  annualPropertyTax: number;
  /** Inflation-proof rental income from a second property (today's money). */
  monthlyRentalIncome: number;
  /** UI-only: has the user opened/edited the housing panel yet (drives rent seeding). */
  housingTouched: boolean;
  // Group E
  goalCategories: string[];
  selectedExistingGoalIds: number[];
  newGoals: NewGoalDraft[];
  majorExpenses: string[];
  // Group F
  risk: RiskProfile;
  annualGuaranteedIncome: number;
  semiRetirement: SemiRetirement;
  // Simulation assumptions (pass-1 defaults; editable in the refine panel)
  userLifeExpectancy: number;
  /** Age at which children become independent (support ends). */
  childIndependenceAge: number;
  /** Life expectancy used to end support for non-child dependants. */
  dependantLifeExpectancy: number;
  /** Partner income added at marriage; null → default to doubling current income. */
  marriagePartnerIncome: number | null;
  childLeaveYears: number;
  childLeaveDrop: number;
  // Per-child cost model (today's money), applied to every child by their age.
  /** General upkeep per child per month (food, clothing, activities), birth → independence. */
  childUpkeepMonthly: number;
  /** School fees per child per month, during the schooling years. */
  childSchoolMonthly: number;
  /** Higher-education cost per child per year, from school-end to independence. */
  childCollegeAnnual: number;
  childSchoolStartAge: number;
  childSchoolEndAge: number;
}

const DEFAULTS: FormState = {
  currentAge: 35,
  country: "",
  city: "",
  household: "single_income_no_dep",
  dependants: [],
  expectSecondIncome: false,
  secondIncomeAtAge: 0,
  annualIncome: 0,
  currentNetWorth: 0,
  annualSavings: 0,
  targetAge: 50,
  retirementLocation: "same_city",
  lifestyle: "moderate",
  retirementCountry: "",
  retirementCity: "",
  homeTierOverride: null,
  retirementTierOverride: null,
  manualLocationFactorPct: null,
  monthlySpendRetirement: 0,
  retirementSpendIncludesDependants: true,
  dependantMonthlyCost: 0,
  housingIncludesRent: true,
  housingChoice: "rent",
  monthlyRent: 0,
  monthlySocietyFees: 0,
  annualPropertyTax: 0,
  monthlyRentalIncome: 0,
  housingTouched: false,
  goalCategories: [],
  selectedExistingGoalIds: [],
  newGoals: [],
  majorExpenses: [],
  risk: "moderate",
  annualGuaranteedIncome: 0,
  semiRetirement: "maybe",
  userLifeExpectancy: USER_LIFE_EXPECTANCY_DEFAULT,
  childIndependenceAge: KID_INDEPENDENCE_DEFAULT,
  dependantLifeExpectancy: DEPENDANT_LIFE_EXP_DEFAULT,
  marriagePartnerIncome: null,
  childLeaveYears: CHILD_LEAVE_YEARS_DEFAULT,
  childLeaveDrop: CHILD_LEAVE_DROP_DEFAULT,
  childUpkeepMonthly: 0,
  childSchoolMonthly: 0,
  childCollegeAnnual: 0,
  childSchoolStartAge: CHILD_SCHOOL_START_DEFAULT,
  childSchoolEndAge: CHILD_SCHOOL_END_DEFAULT,
};

const HOUSEHOLD_OPTIONS: { value: HouseholdKind; label: string }[] = [
  { value: "single_income_no_dep", label: "Single income · no dependants" },
  { value: "double_income_no_dep", label: "Double income · no dependants" },
  { value: "single_income_dep", label: "Single income · with dependants" },
  { value: "double_income_dep", label: "Double income · with dependants" },
];

const DEPENDANT_TYPE_OPTIONS: { value: DependantType; label: string; defaultAge: number }[] = [
  { value: "children", label: "Children", defaultAge: 5 },
  { value: "spouse_partner", label: "Spouse / partner", defaultAge: 35 },
  { value: "parents", label: "Parents / in-laws", defaultAge: 70 },
  { value: "siblings", label: "Siblings", defaultAge: 30 },
  { value: "other", label: "Other", defaultAge: 40 },
];

/** Build a fresh dependant row with a sensible default age for its type. */
function makeDependant(type: DependantType, future = false): DependantDraft {
  const opt = DEPENDANT_TYPE_OPTIONS.find((o) => o.value === type);
  return { id: crypto.randomUUID(), type, age: opt?.defaultAge ?? 30, future };
}

/**
 * A life goal the household situation makes likely. These don't alter the
 * corpus math directly — the user's monthly spend already covers *current*
 * dependants. Instead they prompt the *future* events a given stage tends to
 * bring (a wedding, a first child, education or elder-care funds) so the user
 * can add them as dated goals and see them on the FIRE timeline.
 */
interface GoalSuggestion {
  key: string;
  /** Prefilled goal name. */
  name: string;
  /** Why this is suggested + its income/expense consequence. */
  note: string;
  /** When set, the simulation reads the goal's date as a modelled income event. */
  kind?: GoalKind;
}

/** Suggestions driven by the household stage itself (next likely life event). */
const HOUSEHOLD_GOAL_SUGGESTIONS: Record<HouseholdKind, GoalSuggestion[]> = {
  single_income_no_dep: [
    {
      key: "marriage",
      name: "Marriage / wedding",
      note: "A wedding is a one-time expense to plan for. (The second income a partner brings is modelled from the life-stage step.)",
    },
  ],
  double_income_no_dep: [
    {
      key: "first_child",
      name: "First child",
      note: "Parental leave dips one income for a while, and a child adds ongoing costs until they're independent — both modelled from the goal date.",
      kind: "child",
    },
  ],
  single_income_dep: [],
  double_income_dep: [],
};

/** Extra suggestions driven by the *type* of existing dependants. */
const DEPENDANT_GOAL_SUGGESTIONS: Record<DependantType, GoalSuggestion[]> = {
  children: [
    {
      key: "child_education",
      name: "Child's education fund",
      note: "School and college costs land in big lumps — a dedicated fund keeps them off your retirement corpus.",
    },
  ],
  parents: [
    {
      key: "parent_care",
      name: "Parents' care & healthcare",
      note: "Elder care and medical costs climb with age — earmark a fund so they don't derail FIRE.",
    },
  ],
  spouse_partner: [
    {
      key: "spouse_support",
      name: "Partner support buffer",
      note: "Supporting a non-earning partner means your corpus covers two — size it accordingly.",
    },
  ],
  siblings: [
    {
      key: "sibling_support",
      name: "Sibling support",
      note: "If you support a sibling, add a dated goal so the cost is planned, not a surprise.",
    },
  ],
  other: [
    {
      key: "dependant_support",
      name: "Dependant support fund",
      note: "Earmark a fund for your other dependants' future needs.",
    },
  ],
};

/** Compose the de-duplicated suggestion list for a given household + dependants. */
function suggestedGoalsFor(
  household: HouseholdKind,
  dependantTypes: DependantType[],
): GoalSuggestion[] {
  const out: GoalSuggestion[] = [...HOUSEHOLD_GOAL_SUGGESTIONS[household]];
  if (HOUSEHOLD_HAS_DEPENDANTS[household]) {
    for (const t of dependantTypes) out.push(...DEPENDANT_GOAL_SUGGESTIONS[t]);
  }
  // De-dup by key, preserving order.
  return out.filter((s, i) => out.findIndex((o) => o.key === s.key) === i);
}

const LIFESTYLE_OPTIONS: { value: Lifestyle; label: string; hint: string }[] = [
  { value: "lean", label: "Lean", hint: "Minimal spend, maximum freedom" },
  { value: "moderate", label: "Moderate", hint: "Comfortable but not extravagant" },
  { value: "comfortable", label: "Comfortable", hint: "Travel, hobbies, dining out regularly" },
  { value: "fat", label: "Fat FIRE", hint: "Luxury lifestyle, no compromises" },
];

const TIER_OPTIONS: { value: CostTier; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const LOCATION_OPTIONS: { value: RetirementLocation; label: string }[] = [
  { value: "same_city", label: "Same country, same city" },
  { value: "same_country_lower", label: "Same country, lower-cost area" },
  { value: "abroad_lower", label: "Move abroad (lower cost)" },
  { value: "abroad_similar", label: "Move abroad (similar cost)" },
  { value: "undecided", label: "Undecided" },
];

const RISK_OPTIONS: { value: RiskProfile; label: string; hint: string }[] = [
  { value: "conservative", label: "Very conservative", hint: "Bonds / cash heavy · ~3% real return · 3.5% SWR" },
  { value: "moderate", label: "Moderate", hint: "Balanced portfolio · ~5% real return · 4% SWR" },
  { value: "growth", label: "Growth-oriented", hint: "Mostly equities · ~7% real return · 4.5% SWR" },
  { value: "aggressive", label: "Aggressive", hint: "High equity + alternatives · ~8.5% real return · 4.5% SWR" },
];

const SEMI_OPTIONS: { value: SemiRetirement; label: string }[] = [
  { value: "love", label: "Yes, I'd love that" },
  { value: "maybe", label: "Maybe, if it's enjoyable" },
  { value: "passive", label: "Prefer fully passive" },
  { value: "clean_break", label: "Clean break from all work" },
];

const STEPS = [
  "Welcome",
  "Life stage",
  "Financial snapshot",
  "Retirement vision",
  "Retirement spending",
  "Life goals",
  "Risk & assumptions",
  "Your FIRE plan",
] as const;

const TOTAL_STEPS = STEPS.length;

/**
 * Estimate annual gross income from imported tax data.
 *
 * With a single year of data we use that value directly. With several years we
 * fit the (assessment-year → gross income) trend with a least-squares straight
 * line and read off the latest year, so a one-off spike or dip in the final
 * filing doesn't dominate. The estimate is clamped to a sane range and returned
 * with the number of years used (so the UI can explain itself). Null when no tax
 * data is available.
 */
async function estimateGrossIncomeFromTax(): Promise<{ value: number; years: number } | null> {
  const taxYears = await listTaxYears(); // ordered ay DESC; order is irrelevant to the fit
  const assessments = await Promise.all(taxYears.map((y) => getAssessment(y.ay)));
  const points: Array<[number, number]> = [];
  taxYears.forEach((y, i) => {
    const income = assessments[i]?.gross_total_income;
    const yr = Number((y.ay.match(/(\d{4})/) ?? [])[1]); // 'AY2026-27' → 2026
    if (income != null && income > 0 && yr) points.push([yr, income]);
  });
  if (points.length === 0) return null;
  if (points.length === 1) return { value: points[0][1], years: 1 };

  const latestYear = Math.max(...points.map(([x]) => x));
  const rawLatest = points.find(([x]) => x === latestYear)![1];
  const fit = polynomialTrendEstimate(points, latestYear, 1);
  const maxObserved = Math.max(...points.map(([, y]) => y));
  // Clamp to guard against a degenerate fit producing a wild value.
  const value = fit == null
    ? rawLatest
    : Math.max(0, Math.min(Math.round(fit), Math.round(maxObserved * 3)));
  return { value, years: points.length };
}

export function FireCalculatorPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const residenceCountry = useSettingsStore((s) => s.settings.residenceCountry);
  const residenceCity = useSettingsStore((s) => s.settings.residenceCity);

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [step, setStep] = useState(0);
  const [existingGoals, setExistingGoals] = useState<Goal[]>([]);
  const [prefilled, setPrefilled] = useState(false);
  const [incomePrefilled, setIncomePrefilled] = useState(false);
  const [incomeFromTrend, setIncomeFromTrend] = useState(false);
  const [savingsPrefilled, setSavingsPrefilled] = useState(false);
  const [guaranteedPrefilled, setGuaranteedPrefilled] = useState(false);
  // Net-worth amount pulled out as retirement income (NPS/EPF/PPF), for the hint.
  const [pensionExcluded, setPensionExcluded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingGoals, setSavingGoals] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // The plan is a pure projection of the form, so it recomputes live (e.g. when
  // the user tweaks assumptions in the refine panel on the results screen).
  const view = useMemo(() => buildFireView(form), [form]);

  // Seed residence from Settings, filling only still-empty fields so user edits
  // are never clobbered. Re-runs if the settings store hydrates after mount (so a
  // residence city saved in Settings still lands here). Falls back to India.
  useEffect(() => {
    setForm((prev) => {
      if (prev.country && prev.city) return prev; // both set → nothing to seed
      const c = prev.country || residenceCountry || DEFAULT_COUNTRY;
      const city = prev.city || residenceCity;
      if (c === prev.country && city === prev.city) return prev;
      // Default retirement to the same place (the default "same city" choice).
      const sameCity = prev.retirementLocation === "same_city";
      return {
        ...prev,
        country: c,
        city,
        retirementCountry: sameCity ? c : prev.retirementCountry,
        retirementCity: sameCity ? city : prev.retirementCity,
      };
    });
  }, [residenceCountry, residenceCity]);

  // While "same country, same city" is chosen (the default), keep the retirement
  // location mirrored to the residence. Without this, picking a residence city in
  // step 1 wouldn't fill the retirement city unless the option was re-toggled.
  useEffect(() => {
    if (form.retirementLocation !== "same_city") return;
    setForm((prev) => {
      if (prev.retirementLocation !== "same_city") return prev;
      if (prev.retirementCountry === prev.country && prev.retirementCity === prev.city) return prev;
      return { ...prev, retirementCountry: prev.country, retirementCity: prev.city };
    });
  }, [form.country, form.city, form.retirementLocation]);

  // Prefill from DB.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isTauri()) {
        if (!cancelled) {
          setLoading(false);
          setPrefilled(true);
        }
        return;
      }
      try {
        const [totals, goals, taxIncome, pensionCorpus] = await Promise.all([
          totalsByMonth(),
          listGoals(),
          estimateGrossIncomeFromTax(),
          balanceForTypesLatestMonth(RETIREMENT_INCOME_TYPES),
        ]);
        if (cancelled) return;
        const months = Array.from(totals.keys()).sort();
        const latestNetWorth = months.length ? totals.get(months[months.length - 1]) ?? 0 : 0;
        // Average annual savings over the last (up to) three years of net-worth data.
        const estSavings = estimateAnnualSavings(totals);
        // Locked retirement vehicles (NPS/EPF/PPF): pull them out of the drawdown
        // corpus and model them as a 4% guaranteed income stream instead.
        const drawdownNetWorth = Math.max(0, latestNetWorth - pensionCorpus);
        const guaranteedIncome = Math.round(pensionCorpus * RETIREMENT_INCOME_WITHDRAWAL_RATE);
        setExistingGoals(goals);
        if (taxIncome) {
          setIncomePrefilled(true);
          setIncomeFromTrend(taxIncome.years > 1);
        }
        if (estSavings != null) setSavingsPrefilled(true);
        if (pensionCorpus > 0) {
          setGuaranteedPrefilled(true);
          setPensionExcluded(pensionCorpus);
        }
        setForm((prev) => ({
          ...prev,
          currentNetWorth: drawdownNetWorth || prev.currentNetWorth,
          annualIncome: taxIncome ? taxIncome.value : prev.annualIncome,
          annualSavings: estSavings ?? prev.annualSavings,
          annualGuaranteedIncome: pensionCorpus > 0 ? guaranteedIncome : prev.annualGuaranteedIncome,
          selectedExistingGoalIds: goals.map((g) => g.id),
        }));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPrefilled(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const computeAndShow = useCallback(async () => {
    setError(null);
    setSavingGoals(true);
    try {
      // Persist any newly drafted goals before showing the plan.
      if (isTauri() && form.newGoals.length > 0) {
        for (const g of form.newGoals) {
          if (g.name.trim() && g.target_amount > 0) {
            await createGoal({
              name: g.name,
              target_amount: g.target_amount,
              target_date: g.target_date || null,
            });
          }
        }
        const fresh = await listGoals();
        setExistingGoals(fresh);
      }

      setStep(TOTAL_STEPS - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingGoals(false);
    }
  }, [form]);

  const next = () => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Validation: per-step "ready to continue".
  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return true;
      case 1: return form.currentAge > 0 && form.currentAge < 120;
      case 2: return form.currentNetWorth >= 0 && form.annualSavings >= 0;
      case 3: return form.targetAge > form.currentAge && form.targetAge < 100;
      case 4: return form.monthlySpendRetirement > 0;
      case 5: return true;
      case 6: return true;
      default: return false;
    }
  }, [step, form]);

  if (loading) {
    return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const visualProgress = ((Math.min(step, TOTAL_STEPS - 1)) / (TOTAL_STEPS - 1)) * 100;

  return (
    <div className="container max-w-2xl py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">
          {STEPS[step]} · {step + 1} / {TOTAL_STEPS}
        </span>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <Flame className="h-6 w-6 text-amber-600" />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">FIRE calculator</h2>
          <p className="text-xs text-muted-foreground">Financial Independence, Retire Early</p>
        </div>
      </div>

      <div className="mb-4 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${visualProgress}%` }} />
      </div>

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {!isTauri() && step === 0 && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Browser mode — you can still run the wizard, but no data will be loaded from or written to the database.
          </CardContent>
        </Card>
      )}

      {step === 0 && <WelcomeStep prefilled={prefilled && isTauri()} netWorth={form.currentNetWorth} annualIncome={incomePrefilled ? form.annualIncome : null} incomeFromTrend={incomeFromTrend} existingGoalCount={existingGoals.length} currency={currency} onNext={next} />}
      {step === 1 && <LifeStageStep form={form} setField={setField} />}
      {step === 2 && <FinancialSnapshotStep form={form} setField={setField} currency={currency} prefilled={prefilled && isTauri()} incomePrefilled={incomePrefilled && isTauri()} incomeFromTrend={incomeFromTrend} savingsPrefilled={savingsPrefilled && isTauri()} pensionExcluded={pensionExcluded} />}
      {step === 3 && <RetirementVisionStep form={form} setField={setField} currency={currency} />}
      {step === 4 && <RetirementSpendingStep form={form} setField={setField} currency={currency} />}
      {step === 5 && (
        <LifeGoalsStep
          form={form}
          setField={setField}
          existingGoals={existingGoals}
          currency={currency}
        />
      )}
      {step === 6 && <RiskStep form={form} setField={setField} currency={currency} guaranteedPrefilled={guaranteedPrefilled && isTauri()} />}
      {step === 7 && (
        <ResultsView
          view={view}
          form={form}
          setField={setField}
          existingGoals={existingGoals.filter((g) => form.selectedExistingGoalIds.includes(g.id))}
          currency={currency}
          onReset={() => setStep(0)}
        />
      )}

      {step > 0 && step < TOTAL_STEPS - 1 && (
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" onClick={back}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step === 6 ? (
            <Button data-testid="fire-compute" onClick={() => void computeAndShow()} disabled={!canAdvance || savingGoals}>
              {savingGoals ? "Saving goals…" : <><Sparkles className="h-4 w-4" /> See my FIRE plan</>}
            </Button>
          ) : (
            <Button data-testid="fire-continue" onClick={next} disabled={!canAdvance}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Steps ----------

function WelcomeStep({
  prefilled, netWorth, annualIncome, incomeFromTrend, existingGoalCount, currency, onNext,
}: {
  prefilled: boolean;
  netWorth: number;
  annualIncome: number | null;
  incomeFromTrend: boolean;
  existingGoalCount: number;
  currency: string;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <h3 className="text-base font-semibold">Let's figure out your FIRE number.</h3>
        <p className="text-sm text-muted-foreground">
          The amount you need invested to never have to work again. I'll ask a few questions across
          your finances, lifestyle, and the life you want to build.
        </p>
        {prefilled && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="font-medium">I've prefilled what I found:</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>· Current net worth: <strong className="tabular-nums">{formatMoney(netWorth, currency)}</strong> (latest month total)</li>
              {annualIncome != null && (
                <li>· Gross annual income: <strong className="tabular-nums">{formatMoney(annualIncome, currency)}</strong> ({incomeFromTrend ? "trend of your tax filings" : "latest tax filing"})</li>
              )}
              <li>· {existingGoalCount} existing {existingGoalCount === 1 ? "goal" : "goals"} ready to fold into the plan</li>
            </ul>
            <p className="mt-2 text-muted-foreground">You'll be able to confirm or change every value.</p>
          </div>
        )}
        <Button data-testid="fire-ready" onClick={onNext}>
          Ready <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function LifeStageStep({
  form, setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <SectionHeading title="Group A · Life stage & context" />

        <Field label="Your current age">
          <Input
            data-testid="fire-age"
            type="number"
            min={16}
            max={110}
            value={form.currentAge || ""}
            onChange={(e) => setField("currentAge", Number(e.target.value))}
            className="max-w-[140px] text-lg tabular-nums"
          />
        </Field>

        <Field label="Country of residence" hint="Used for cost-of-living context.">
          <div className="max-w-md">
            <FiniteSetInput
              masterId="country"
              value={form.country}
              onChange={(v) => { setField("country", v); setField("city", ""); }}
            />
          </div>
        </Field>

        <Field label="City of residence">
          <div className="max-w-md space-y-2">
            <FiniteSetInput
              masterId="city"
              parentValue={form.country || null}
              value={form.city}
              onChange={(v) => setField("city", v)}
            />
            <CityTierControl
              country={form.country}
              city={form.city}
              override={form.homeTierOverride}
              onChange={(t) => setField("homeTierOverride", t)}
            />
          </div>
        </Field>

        <Field label="Household situation">
          <ChoiceGroup
            options={HOUSEHOLD_OPTIONS}
            value={form.household}
            onChange={(v) => {
              setField("household", v);
              if (!HOUSEHOLD_HAS_DEPENDANTS[v]) setField("dependants", []);
              if (!isSingleIncome(v)) setField("expectSecondIncome", false);
            }}
          />
        </Field>

        {HOUSEHOLD_HAS_DEPENDANTS[form.household] && (
          <DependantsEditor
            dependants={form.dependants}
            onChange={(d) => setField("dependants", d)}
          />
        )}

        {isSingleIncome(form.household) && (
          <Field
            label="Might you gain a second income later (e.g. via marriage)?"
            hint="If a partner is likely to start contributing, the plan models that extra income from then on."
          >
            <div className="space-y-3">
              <ChoiceGroup
                options={[
                  { value: "no", label: "No / not planning on it" },
                  { value: "yes", label: "Yes, likely" },
                ] as const}
                value={form.expectSecondIncome ? "yes" : "no"}
                onChange={(v) => {
                  const yes = v === "yes";
                  setField("expectSecondIncome", yes);
                  if (yes && form.secondIncomeAtAge <= form.currentAge) {
                    setField("secondIncomeAtAge", form.currentAge + 2);
                  }
                }}
              />
              {form.expectSecondIncome && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Starting at your age</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={form.currentAge + 1}
                    max={form.targetAge}
                    value={form.secondIncomeAtAge || ""}
                    onChange={(e) => setField("secondIncomeAtAge", Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    className="max-w-[90px] tabular-nums"
                  />
                </div>
              )}
            </div>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

/** Per-type dependant editor: tap a type to add one (default 1), set each age,
 * and optionally flag parents/in-laws who may become dependent in future. */
function DependantsEditor({
  dependants, onChange,
}: {
  dependants: DependantDraft[];
  onChange: (d: DependantDraft[]) => void;
}) {
  const addOf = (type: DependantType, future = false) =>
    onChange([...dependants, makeDependant(type, future)]);
  const update = (id: string, patch: Partial<DependantDraft>) =>
    onChange(dependants.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => onChange(dependants.filter((d) => d.id !== id));

  const current = dependants.filter((d) => !d.future);
  const future = dependants.filter((d) => d.future);

  return (
    <>
      <Field label="Who do you support?" hint="Tap a type to add one (default 1) — add more for each extra dependant.">
        <div className="flex flex-wrap gap-2">
          {DEPENDANT_TYPE_OPTIONS.map((opt) => (
            <Chip key={opt.value} selected={false} onClick={() => addOf(opt.value)}>
              <Plus className="mr-1 inline h-3 w-3" />{opt.label}
            </Chip>
          ))}
        </div>
      </Field>

      {current.length > 0 && (
        <div className="space-y-2">
          {current.map((d) => (
            <DependantRow
              key={d.id}
              dependant={d}
              onAge={(age) => update(d.id, { age })}
              onRemove={() => remove(d.id)}
            />
          ))}
        </div>
      )}

      <Field
        label="Might your parents / in-laws need support in future?"
        hint="If you may have to support them later (not today), add them here — the plan switches their cost on around age 75."
      >
        <div className="flex flex-wrap gap-2">
          <Chip selected={false} onClick={() => addOf("parents", true)}>
            <Plus className="mr-1 inline h-3 w-3" />Possible future dependant
          </Chip>
        </div>
        {future.length > 0 && (
          <div className="mt-2 space-y-2">
            {future.map((d) => (
              <DependantRow
                key={d.id}
                dependant={d}
                future
                onAge={(age) => update(d.id, { age })}
                onSupportYear={(year) => update(d.id, { supportFromYear: year })}
                onRemove={() => remove(d.id)}
              />
            ))}
          </div>
        )}
      </Field>
    </>
  );
}

function DependantRow({
  dependant, future, onAge, onSupportYear, onRemove,
}: {
  dependant: DependantDraft;
  future?: boolean;
  onAge: (age: number) => void;
  onSupportYear?: (year: number | null) => void;
  onRemove: () => void;
}) {
  const label = DEPENDANT_TYPE_OPTIONS.find((o) => o.value === dependant.type)?.label ?? dependant.type;
  // A future dependant already at/past the default switch age (75) can't use the
  // "switches on at 75" assumption — ask when support actually begins instead.
  const needsSwitchYear = !!future && dependant.age >= FUTURE_PARENT_START_DEFAULT;
  const thisYear = new Date().getFullYear();
  return (
    <div className="space-y-2 rounded-md border p-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="min-w-[120px] font-medium">{label}{future && " (future)"}</span>
        <span className="text-xs text-muted-foreground">Age today</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={110}
          value={dependant.age || ""}
          onChange={(e) => onAge(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="max-w-[90px] tabular-nums"
        />
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove" className="ml-auto">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {needsSwitchYear && onSupportYear && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <span className="text-xs text-muted-foreground">
            Already past {FUTURE_PARENT_START_DEFAULT} — from which year will you support them?
          </span>
          <Input
            type="number"
            inputMode="numeric"
            min={thisYear}
            max={thisYear + 60}
            placeholder={String(thisYear)}
            value={dependant.supportFromYear ?? ""}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value) || 0);
              onSupportYear(e.target.value === "" || n <= 0 ? null : n);
            }}
            className="max-w-[110px] tabular-nums"
          />
        </div>
      )}
    </div>
  );
}

function FinancialSnapshotStep({
  form, setField, currency, prefilled, incomePrefilled, incomeFromTrend, savingsPrefilled, pensionExcluded,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  currency: string;
  prefilled: boolean;
  incomePrefilled: boolean;
  incomeFromTrend: boolean;
  savingsPrefilled: boolean;
  /** NPS/EPF/PPF balance pulled out of net worth (counted as retirement income). */
  pensionExcluded: number;
}) {
  const savingsRate = form.annualIncome > 0 ? (form.annualSavings / form.annualIncome) * 100 : null;
  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <SectionHeading title="Group B · Current financial snapshot" />

        <Field
          label="Gross annual household income"
          hint={incomePrefilled
            ? (incomeFromTrend
                ? "Estimated from the trend across your tax filings (smoothing any one-off year) — adjust if needed."
                : "Prefilled from your latest tax filing — adjust if needed.")
            : `In ${currency}.`}
        >
          <MoneyInput
            testId="fire-money-income"
            value={form.annualIncome}
            onChange={(v) => setField("annualIncome", v)}
            currency={currency}
          />
        </Field>

        <Field
          label="Total saved / invested today (net worth, excl. primary home)"
          hint={
            pensionExcluded > 0
              ? `Prefilled from your latest snapshot, with ${formatMoney(pensionExcluded, currency)} of NPS/EPF/PPF set aside as retirement income below — adjust if needed.`
              : prefilled
                ? "Prefilled from your latest monthly snapshot — adjust if needed."
                : `In ${currency}.`
          }
        >
          <MoneyInput
            value={form.currentNetWorth}
            onChange={(v) => setField("currentNetWorth", v)}
            currency={currency}
          />
        </Field>

        <Field
          label="Approximate annual savings"
          hint={savingsPrefilled
            ? "Estimated from your net-worth growth over the last up-to-3 years — adjust if needed."
            : "How much you currently set aside per year."}
        >
          <MoneyInput
            testId="fire-money-savings"
            value={form.annualSavings}
            onChange={(v) => setField("annualSavings", v)}
            currency={currency}
          />
          {savingsRate != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Implied savings rate: <strong>{savingsRate.toFixed(1)}%</strong> of income.
            </p>
          )}
        </Field>
      </CardContent>
    </Card>
  );
}

function RetirementVisionStep({
  form, setField, currency,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  currency: string;
}) {
  const undecided = form.retirementLocation === "undecided";
  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <SectionHeading title="Group C · Retirement vision" />

        <Field label="Target FIRE age" hint="The age you'd love to become financially independent.">
          <Input
            type="number"
            min={Math.max(form.currentAge + 1, 25)}
            max={99}
            value={form.targetAge || ""}
            onChange={(e) => setField("targetAge", Number(e.target.value))}
            className="max-w-[140px] text-lg tabular-nums"
          />
          {form.targetAge <= form.currentAge && (
            <p className="mt-1 text-xs text-destructive">Must be greater than your current age.</p>
          )}
        </Field>

        <Field label="Where do you plan to live in retirement?">
          <ChoiceGroup
            options={LOCATION_OPTIONS}
            value={form.retirementLocation}
            onChange={(v) => {
              setField("retirementLocation", v);
              if (v === "undecided") {
                // No relocation modelled — clear the retirement location.
                setField("retirementCountry", "");
                setField("retirementCity", "");
              } else if (v === "same_city" || !form.retirementCountry) {
                // Default the retirement location to where they live today.
                setField("retirementCountry", form.country);
                setField("retirementCity", v === "same_city" ? form.city : "");
              }
            }}
          />
        </Field>

        {form.retirementLocation === "same_city" ? (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            {form.city ? (
              <>Retiring where you live today: <strong className="text-foreground">{form.city}</strong>. Cost of living is unchanged.</>
            ) : (
              <>Retiring where you live today. Add your <strong className="text-foreground">city of residence</strong> in the Life-stage step to personalise cost-of-living.</>
            )}
          </div>
        ) : !undecided ? (
          <RetirementLocationPicker form={form} setField={setField} currency={currency} />
        ) : null}

        <Field label="Retirement lifestyle">
          <ChoiceGroup
            options={LIFESTYLE_OPTIONS}
            value={form.lifestyle}
            onChange={(v) => setField("lifestyle", v)}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

/** Retirement country/city + the detected cost-of-living factor (PPP or COL),
 * with a manual % override. Lives in pass 1 (Retirement vision). */
function RetirementLocationPicker({
  form, setField, currency,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  currency: string;
}) {
  const { factor, basis } = locationCostFactor({
    homeCountry: form.country,
    homeCity: form.city,
    retirementCountry: form.retirementCountry,
    retirementCity: form.retirementCity,
    retirementUndecided: !form.retirementCountry,
    manualLocationFactorPct: form.manualLocationFactorPct,
    homeTierOverride: form.homeTierOverride,
    retirementTierOverride: form.retirementTierOverride,
  });
  const retCurrency = currencyForCountry(form.retirementCountry) || currency;
  const crossCurrency = retCurrency !== currency;
  const basisLabel =
    basis === "manual" ? "manual override"
      : basis === "ppp" ? `PPP-based (${currency} ↔ ${retCurrency})`
        : basis === "col" ? "city cost-of-living"
          : "no adjustment";

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <h4 className="text-sm font-semibold">Retirement location</h4>
        <p className="text-xs text-muted-foreground">
          Where you retire changes your costs. We scale your non-rent spend by a cost-of-living
          factor — purchasing-power parity when the currency differs, otherwise the city cost gap.
        </p>
      </div>

      <Field label="Retirement country">
        <div className="max-w-md">
          <FiniteSetInput
            masterId="country"
            value={form.retirementCountry}
            onChange={(v) => { setField("retirementCountry", v); setField("retirementCity", ""); }}
          />
        </div>
      </Field>

      <Field label="Retirement city">
        <div className="max-w-md space-y-2">
          <FiniteSetInput
            masterId="city"
            parentValue={form.retirementCountry || null}
            value={form.retirementCity}
            onChange={(v) => setField("retirementCity", v)}
          />
          <CityTierControl
            country={form.retirementCountry}
            city={form.retirementCity}
            override={form.retirementTierOverride}
            onChange={(t) => setField("retirementTierOverride", t)}
          />
        </div>
      </Field>

      <div className="rounded-md bg-muted/30 p-3 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Cost-of-living factor</span>
          <span className="text-base font-semibold tabular-nums">{factor.toFixed(2)}×</span>
        </div>
        <p className="mt-1 text-muted-foreground">
          {factor < 1
            ? <>Your lifestyle costs ~<strong>{Math.round((1 - factor) * 100)}% less</strong> there</>
            : factor > 1
              ? <>Your lifestyle costs ~<strong>{Math.round((factor - 1) * 100)}% more</strong> there</>
              : <>Same cost as where you live today</>}{" "}
          ({basisLabel}).
          {crossCurrency && (
            <> A spend of {formatMoney(form.monthlySpendRetirement, currency)}/mo here is
              ~{formatMoney(form.monthlySpendRetirement * factor, retCurrency)}/mo in {retCurrency}.</>
          )}
        </p>
      </div>

      <Field
        label="Override the factor manually?"
        hint="Leave blank to use the detected factor. Enter a percentage, e.g. 70 means retirement costs 70% of your current lifestyle."
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder={`${Math.round(factor * 100)}`}
            value={form.manualLocationFactorPct ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              setField("manualLocationFactorPct", e.target.value === "" || n <= 0 ? null : n);
            }}
            className="max-w-[120px] tabular-nums"
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </Field>
    </div>
  );
}

/** Detected-tier hint + a low/medium/high override (Auto = use detected). */
function CityTierControl({
  country, city, override, onChange,
}: {
  country: string;
  city: string;
  override: CostTier | null;
  onChange: (t: CostTier | null) => void;
}) {
  const { index, known } = cityCostIndex(country, city);
  const detected = cityCostTier(index);
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-2">
      <div className="text-muted-foreground">
        {city ? (
          known
            ? <>Detected cost tier for <strong>{city}</strong>: <strong>{COST_TIER_LABEL[detected]}</strong>.</>
            : <><strong>{city}</strong> isn't in our cost index — assuming <strong>{COST_TIER_LABEL[detected]}</strong>. Override if needed.</>
        ) : (
          <>Pick a city to detect its cost-of-living tier.</>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Tier:</span>
        <Chip selected={override === null} onClick={() => onChange(null)}>
          Auto{known ? ` · ${COST_TIER_LABEL[detected]}` : ""}
        </Chip>
        {TIER_OPTIONS.map((o) => (
          <Chip key={o.value} selected={override === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function RetirementSpendingStep({
  form, setField, currency,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  currency: string;
}) {
  const hasChild = formHasChild(form);
  const hasNonChildDep = form.dependants.some((d) => d.type !== "children");
  const hasAnyDependant = hasChild || hasNonChildDep;

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <SectionHeading title="Group D · Monthly spending in retirement" />
        <p className="text-sm text-muted-foreground">
          What monthly household spend (today's money) do you want to support in retirement?
          Cover housing, food, transport, healthcare, travel, hobbies, giving — we'll handle
          dependant-specific costs (kids' schooling, elder care) separately below.
        </p>

        <Field label={`Desired monthly household spend (${currency})`}>
          <MoneyInput
            testId="fire-money-spend"
            value={form.monthlySpendRetirement}
            onChange={(v) => setField("monthlySpendRetirement", v)}
            currency={currency}
          />
          {form.monthlySpendRetirement > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Annualises to <strong className="tabular-nums">{formatMoney(form.monthlySpendRetirement * 12, currency)}</strong>/year today.
            </p>
          )}
        </Field>

        {hasAnyDependant && (
          <Field
            label="Does that spend already include your dependants' costs?"
            hint="This lets the plan taper those costs as dependants become independent or pass their life expectancy, instead of carrying them forever."
          >
            <ChoiceGroup
              options={[
                { value: "yes", label: "Yes, it includes them" },
                { value: "no", label: "No, it's just us" },
              ] as const}
              value={form.retirementSpendIncludesDependants ? "yes" : "no"}
              onChange={(v) => setField("retirementSpendIncludesDependants", v === "yes")}
            />
          </Field>
        )}

        {hasChild && (
          <div className="space-y-4 rounded-md border p-4">
            <div>
              <h4 className="text-sm font-semibold">Children's costs (per child, today's money)</h4>
              <p className="text-xs text-muted-foreground">
                Each child's costs switch on and off by age: upkeep until independence, school
                fees during the schooling years, and higher-education costs after that.
              </p>
            </div>
            <Field label={`General upkeep / month (${currency})`} hint="Food, clothing, activities — birth until independence.">
              <MoneyInput
                value={form.childUpkeepMonthly}
                onChange={(v) => setField("childUpkeepMonthly", v)}
                currency={currency}
              />
            </Field>
            <Field
              label={`School fees / month (${currency})`}
              hint={`Charged from age ${form.childSchoolStartAge} to ${form.childSchoolEndAge}.`}
            >
              <MoneyInput
                value={form.childSchoolMonthly}
                onChange={(v) => setField("childSchoolMonthly", v)}
                currency={currency}
              />
            </Field>
            <Field
              label={`Higher education / year (${currency})`}
              hint={`Charged from age ${form.childSchoolEndAge} to independence (${form.childIndependenceAge}).`}
            >
              <MoneyInput
                value={form.childCollegeAnnual}
                onChange={(v) => setField("childCollegeAnnual", v)}
                currency={currency}
              />
            </Field>
          </div>
        )}

        {hasNonChildDep && (
          <Field
            label={`Monthly cost to support your other dependants today (${currency})`}
            hint={
              form.retirementSpendIncludesDependants
                ? "Parents, partner, siblings etc. (excludes children — set above). Removed as each passes their life expectancy."
                : "Parents, partner, siblings etc. Added on top of your own spend, tapered over their life expectancy."
            }
          >
            <MoneyInput
              value={form.dependantMonthlyCost}
              onChange={(v) => setField("dependantMonthlyCost", v)}
              currency={currency}
            />
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

function LifeGoalsStep({
  form, setField, existingGoals, currency,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  existingGoals: Goal[];
  currency: string;
}) {
  const toggleCategory = (key: string) => {
    setField(
      "goalCategories",
      form.goalCategories.includes(key)
        ? form.goalCategories.filter((k) => k !== key)
        : [...form.goalCategories, key],
    );
  };
  const toggleExistingGoal = (id: number) => {
    setField(
      "selectedExistingGoalIds",
      form.selectedExistingGoalIds.includes(id)
        ? form.selectedExistingGoalIds.filter((g) => g !== id)
        : [...form.selectedExistingGoalIds, id],
    );
  };
  const toggleMajorExpense = (key: string) => {
    setField(
      "majorExpenses",
      form.majorExpenses.includes(key)
        ? form.majorExpenses.filter((k) => k !== key)
        : [...form.majorExpenses, key],
    );
  };

  const addNewGoalDraft = () => {
    setField("newGoals", [...form.newGoals, { name: "", target_amount: 0, target_date: "" }]);
  };
  const addSuggestedGoal = (s: GoalSuggestion) => {
    if (form.newGoals.some((g) => g.name === s.name)) return;
    setField("newGoals", [...form.newGoals, { name: s.name, target_amount: 0, target_date: "", kind: s.kind }]);
  };
  const dependantTypes = Array.from(new Set(form.dependants.map((d) => d.type)));
  const suggestions = suggestedGoalsFor(form.household, dependantTypes);
  const updateNewGoal = (idx: number, patch: Partial<NewGoalDraft>) => {
    setField(
      "newGoals",
      form.newGoals.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    );
  };
  const removeNewGoal = (idx: number) => {
    setField("newGoals", form.newGoals.filter((_, i) => i !== idx));
  };

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <SectionHeading title="Group E · Life goals (the why)" />
        <p className="text-sm text-muted-foreground">
          FIRE isn't just a number — it's about the life you want to live. Tell me about your big goals.
        </p>

        {suggestions.length > 0 && (
          <Field
            label="Likely goals for your household"
            hint="Based on your household situation. Add any that fit — they'll become dated goals on your timeline."
          >
            <div className="space-y-2">
              {suggestions.map((s) => {
                const added = form.newGoals.some((g) => g.name === s.name);
                return (
                  <div
                    key={s.key}
                    className="flex items-start gap-3 rounded-md border border-dashed p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.note}</div>
                    </div>
                    <Button
                      variant={added ? "ghost" : "outline"}
                      size="sm"
                      disabled={added}
                      onClick={() => addSuggestedGoal(s)}
                    >
                      {added ? <><CheckCircle2 className="h-4 w-4" /> Added</> : <><Plus className="h-4 w-4" /> Add</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Which life goals matter to you?" hint="Select all that apply.">
          <div className="flex flex-wrap gap-2">
            {LIFE_GOAL_CATEGORIES.map((g) => (
              <Chip key={g.key} selected={form.goalCategories.includes(g.key)} onClick={() => toggleCategory(g.key)}>
                {g.label}
              </Chip>
            ))}
          </div>
        </Field>

        {existingGoals.length > 0 && (
          <Field
            label="Your existing goals"
            hint="Already saved in this app. Tick which ones to fold into the FIRE timeline."
          >
            <div className="space-y-1.5">
              {existingGoals.map((g) => (
                <label
                  key={g.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm transition-colors",
                    form.selectedExistingGoalIds.includes(g.id) ? "border-primary/60 bg-primary/5" : "hover:bg-accent",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={form.selectedExistingGoalIds.includes(g.id)}
                    onChange={() => toggleExistingGoal(g.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{g.name}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      Target {formatMoney(g.target_amount, currency)}{g.target_date && <> by {g.target_date}</>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        )}

        <Field
          label={existingGoals.length > 0 ? "Add a new goal" : "Add goals"}
          hint="These will be saved to your goals list when you finish the wizard."
        >
          {form.newGoals.length === 0 && (
            <p className="text-xs text-muted-foreground">No new goals yet.</p>
          )}
          <div className="space-y-2">
            {form.newGoals.map((g, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[1fr_140px_140px_auto]">
                <Input
                  placeholder="e.g. World trip"
                  value={g.name}
                  onChange={(e) => updateNewGoal(idx, { name: e.target.value })}
                />
                <Input
                  type="number"
                  placeholder={`Amount (${currency})`}
                  value={g.target_amount || ""}
                  onChange={(e) => updateNewGoal(idx, { target_amount: Number(e.target.value) })}
                  className="tabular-nums"
                />
                <Input
                  type="date"
                  value={g.target_date}
                  onChange={(e) => updateNewGoal(idx, { target_date: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeNewGoal(idx)}
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addNewGoalDraft}>
              <Plus className="h-4 w-4" /> Add goal
            </Button>
          </div>
        </Field>

        <Field label="Major one-time expenses expected in the next 10 years?">
          <div className="flex flex-wrap gap-2">
            {MAJOR_EXPENSE_OPTIONS.map((g) => (
              <Chip key={g.key} selected={form.majorExpenses.includes(g.key)} onClick={() => toggleMajorExpense(g.key)}>
                {g.label}
              </Chip>
            ))}
          </div>
        </Field>
      </CardContent>
    </Card>
  );
}

function RiskStep({
  form, setField, currency, guaranteedPrefilled,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  currency: string;
  guaranteedPrefilled: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <SectionHeading title="Group F · Risk & assumptions" />

        <Field label="How comfortable are you with investment risk?">
          <ChoiceGroup
            options={RISK_OPTIONS}
            value={form.risk}
            onChange={(v) => setField("risk", v)}
          />
        </Field>

        <Field
          label="Annual guaranteed income in retirement (today's money)"
          hint={guaranteedPrefilled
            ? "Estimated as 4% of your NPS/EPF/PPF balances (set aside from net worth). Add any pension, annuity, or social security on top — adjust if needed."
            : "Pension, NPS annuity, social security, rental income, etc. Use 0 if none."}
        >
          <MoneyInput
            value={form.annualGuaranteedIncome}
            onChange={(v) => setField("annualGuaranteedIncome", v)}
            currency={currency}
          />
        </Field>

        <Field label="Open to part-time / passion work income in semi-retirement?">
          <ChoiceGroup
            options={SEMI_OPTIONS}
            value={form.semiRetirement}
            onChange={(v) => setField("semiRetirement", v)}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

// ---------- Results ----------

function ResultsView({
  view, form, setField, existingGoals, currency, onReset,
}: {
  view: FireView;
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  existingGoals: Goal[];
  currency: string;
  onReset: () => void;
}) {
  const { sim, variant, sensitivity } = view;
  const variantLabel = FIRE_VARIANT_LABEL[variant];
  const variantBlurb = FIRE_VARIANT_BLURB[variant];

  const corpus = sim.requiredCorpusAtTarget;
  const requiredMonthlySavings = sim.currentMonthlySavings + sim.requiredAdditionalMonthlySavings;
  const monthlySavingsGap = sim.requiredAdditionalMonthlySavings;
  const progressPct = Math.round(sim.progress * 100);
  const horizonYears = Math.max(0, form.targetAge - form.currentAge);

  // Build timeline events: existing goals with dates, new goals from form, FIRE achieved.
  const events = useMemo(() => {
    const out: { age: number; label: string; cost: number | null; highlight?: boolean }[] = [];
    for (const g of existingGoals) {
      if (g.target_date) {
        const yr = Number(g.target_date.slice(0, 4));
        if (yr) {
          const ageAtGoal = form.currentAge + (yr - new Date().getFullYear());
          out.push({ age: ageAtGoal, label: g.name, cost: g.target_amount });
        }
      }
    }
    for (const g of form.newGoals) {
      if (!g.name.trim() || g.target_amount <= 0) continue;
      if (g.target_date) {
        const yr = Number(g.target_date.slice(0, 4));
        if (yr) {
          const ageAtGoal = form.currentAge + (yr - new Date().getFullYear());
          out.push({ age: ageAtGoal, label: g.name, cost: g.target_amount });
        }
      }
    }
    out.push({ age: form.targetAge, label: "FIRE achieved", cost: null, highlight: true });
    if (sim.fireAgeAtCurrentSavings != null && Math.round(sim.fireAgeAtCurrentSavings) !== form.targetAge) {
      out.push({
        age: Math.round(sim.fireAgeAtCurrentSavings),
        label: `FIRE at current savings rate`,
        cost: null,
      });
    }
    out.sort((a, b) => a.age - b.age);
    return out;
  }, [existingGoals, form, sim]);

  return (
    <div className="space-y-4">
      {/* Hero */}
      <Card className="overflow-hidden border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card">
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your FIRE number
            </span>
          </div>
          <div data-testid="fire-result" className="text-4xl font-bold tabular-nums">{formatMoney(corpus, currency)}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatBlock label="Target age" value={String(form.targetAge)} />
            <StatBlock label="Years away" value={`${horizonYears} yrs`} />
            <StatBlock
              label="Monthly savings needed"
              value={`${formatMoney(requiredMonthlySavings, currency)}/mo`}
            />
          </div>
          <div className="rounded-md bg-background/40 p-3 text-xs">
            <span className="font-semibold">{variantLabel}</span> — {variantBlurb}
          </div>
          {sim.peakRetirementExpense > sim.expenseAtTarget + 1 && (
            <div className="rounded-md bg-background/40 p-3 text-xs text-muted-foreground">
              Retirement spend isn't flat: it peaks at{" "}
              <strong className="tabular-nums">{formatMoney(sim.peakRetirementExpense, currency)}/yr</strong>{" "}
              while dependants are supported, easing to{" "}
              <strong className="tabular-nums">{formatMoney(sim.expenseAtTarget, currency)}/yr</strong> as they become independent.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">Progress toward target</span>
            <span className="tabular-nums text-muted-foreground">{progressPct}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-to-r from-primary to-amber-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{formatMoney(form.currentNetWorth, currency)} today</span>
            <span>{formatMoney(corpus, currency)} target</span>
          </div>
        </CardContent>
      </Card>

      {/* Savings gap */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <h3 className="text-sm font-semibold">Monthly savings: needed vs current</h3>
          <div className="flex items-baseline gap-3 text-sm">
            <span className="text-muted-foreground">Current</span>
            <span className="font-medium tabular-nums">{formatMoney(sim.currentMonthlySavings, currency)}/mo</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Needed</span>
            <span className="font-medium tabular-nums">{formatMoney(requiredMonthlySavings, currency)}/mo</span>
          </div>
          {monthlySavingsGap > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Gap of <strong className="tabular-nums">{formatMoney(monthlySavingsGap, currency)}/mo</strong> to hit your target age.
            </p>
          ) : (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              You're saving enough to hit the target by {form.targetAge}.
            </p>
          )}
          {sim.fireAgeAtCurrentSavings != null ? (
            <p className="text-xs text-muted-foreground">
              At your current savings pace, projected FIRE age ≈ <strong>{sim.fireAgeAtCurrentSavings.toFixed(1)}</strong>{" "}
              ({sim.yearsToFireAtCurrentSavings != null ? sim.yearsToFireAtCurrentSavings.toFixed(1) : "—"} years from now).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              At your current savings pace, the corpus isn't reached by life expectancy — increase savings or adjust the plan.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Target className="h-4 w-4" /> Life goals timeline
          </h3>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No goals on the timeline yet.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((ev, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className={cn("mt-0.5 text-base", ev.highlight && "text-amber-600")}>
                    {ev.highlight ? "🏁" : "●"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-medium", ev.highlight && "text-amber-700 dark:text-amber-400")}>
                      Age {ev.age}: {ev.label}
                    </div>
                    {ev.cost != null && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatMoney(ev.cost, currency)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Assumptions */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <h3 className="text-sm font-semibold">Assumptions & sensitivities</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Scenario</th>
                  <th className="py-1 pr-3 font-medium">Real return</th>
                  <th className="py-1 pr-3 font-medium">Corpus</th>
                  <th className="py-1 font-medium">FIRE age</th>
                </tr>
              </thead>
              <tbody>
                {sensitivity.map((row) => (
                  <tr key={row.scenario} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{row.scenario}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{(row.realReturn * 100).toFixed(1)}%</td>
                    <td className="py-1.5 pr-3 tabular-nums">{formatMoney(row.corpus, currency)}</td>
                    <td className="py-1.5 tabular-nums">
                      {row.fireAge != null ? row.fireAge.toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Base case uses your selected risk profile ({RISK_PROFILES[form.risk].label.toLowerCase()}). The corpus is
            sized to fund your actual, varying expenses until age {form.userLifeExpectancy} (depletion, not a flat 4% rule).
          </p>
        </CardContent>
      </Card>

      <RefinePanel view={view} form={form} setField={setField} currency={currency} />

      <ReportCard view={view} form={form} currency={currency} />

      {/* Next actions */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Your next 3 actions
          </h3>
          <ol className="space-y-2 pl-4 text-sm">
            <li className="list-decimal">
              {monthlySavingsGap > 0
                ? <>Increase monthly savings by <strong className="tabular-nums">{formatMoney(monthlySavingsGap, currency)}</strong> to hit FIRE by {form.targetAge}.</>
                : <>Maintain your current savings rate — you're on track for FIRE by {form.targetAge}.</>}
            </li>
            <li className="list-decimal">
              Align your portfolio with a <strong>{RISK_PROFILES[form.risk].label.toLowerCase()}</strong> allocation
              (assumed {(sim.realReturn * 100).toFixed(0)}% real return).
            </li>
            <li className="list-decimal">
              {form.newGoals.length > 0 || existingGoals.length > 0
                ? <>Track your life goals — visit the Goals tab to see progress and ETAs.</>
                : <>Add at least one near-term goal in the Goals tab so you can track interim wins.</>}
            </li>
          </ol>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onReset}>
          <ArrowLeft className="h-4 w-4" /> Edit answers
        </Button>
        <Button asChild>
          <Link to="/goals"><Save className="h-4 w-4" /> Open my goals</Link>
        </Button>
      </div>

      <p className="px-1 text-[11px] text-muted-foreground">
        This is informational only. Validate with a financial advisor before making decisions.
      </p>
    </div>
  );
}

/**
 * Pass-2 refinement: first-pass assumptions are stated here and made editable.
 * Because the plan is a pure projection of the form, edits recompute the whole
 * results view live — no recompute button needed.
 */
function RefinePanel({
  view, form, setField, currency,
}: {
  view: FireView;
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const hasMarriage = isSingleIncome(form.household) && form.expectSecondIncome;
  const hasChild = formHasChild(form);
  const hasNonChildDep = form.dependants.some((d) => d.type !== "children");

  const num = (k: keyof FormState, value: number) =>
    setField(k, Math.max(0, Math.floor(value)) as never);

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-3 py-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between text-left"
        >
          <h3 className="text-sm font-semibold">Refine the assumptions</h3>
          <span className="text-xs text-muted-foreground">{open ? "Hide" : "Adjust & recompute"}</span>
        </button>
        <p className="text-xs text-muted-foreground">
          First pass used: life expectancy <strong>{form.userLifeExpectancy}</strong>, children independent at{" "}
          <strong>{form.childIndependenceAge}</strong>
          {hasMarriage && <> , marriage <strong>doubles income</strong></>}. Adjust below and the plan updates instantly.
        </p>

        {open && (
          <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">
            <RefineNumber
              label="Your life expectancy"
              hint="Plan funds expenses until this age."
              value={form.userLifeExpectancy}
              onChange={(v) => num("userLifeExpectancy", v)}
            />
            {hasChild && (
              <RefineNumber
                label="Children independent at age"
                hint="Child-specific costs stop here."
                value={form.childIndependenceAge}
                onChange={(v) => num("childIndependenceAge", v)}
              />
            )}
            {hasNonChildDep && (
              <RefineNumber
                label="Dependant life expectancy"
                hint="Support for parents/others ends here."
                value={form.dependantLifeExpectancy}
                onChange={(v) => num("dependantLifeExpectancy", v)}
              />
            )}
            {hasMarriage && (
              <Field
                label={`Partner income at marriage (${currency})`}
                hint={`Blank = double your income (${formatMoney(form.annualIncome, currency)}).`}
              >
                <MoneyInput
                  value={form.marriagePartnerIncome ?? 0}
                  onChange={(v) => setField("marriagePartnerIncome", v > 0 ? v : null)}
                  currency={currency}
                />
              </Field>
            )}
            {hasChild && (
              <>
                <Field label={`Child upkeep / month (${currency})`} hint="Birth → independence.">
                  <MoneyInput
                    value={form.childUpkeepMonthly}
                    onChange={(v) => setField("childUpkeepMonthly", v)}
                    currency={currency}
                  />
                </Field>
                <Field label={`School fees / month (${currency})`} hint={`Ages ${form.childSchoolStartAge}–${form.childSchoolEndAge}.`}>
                  <MoneyInput
                    value={form.childSchoolMonthly}
                    onChange={(v) => setField("childSchoolMonthly", v)}
                    currency={currency}
                  />
                </Field>
                <Field label={`Higher education / year (${currency})`} hint={`Age ${form.childSchoolEndAge} → ${form.childIndependenceAge}.`}>
                  <MoneyInput
                    value={form.childCollegeAnnual}
                    onChange={(v) => setField("childCollegeAnnual", v)}
                    currency={currency}
                  />
                </Field>
                <RefineNumber
                  label="School starts at age"
                  hint="School fees begin here."
                  value={form.childSchoolStartAge}
                  onChange={(v) => num("childSchoolStartAge", v)}
                />
                <RefineNumber
                  label="School ends at age"
                  hint="School → higher-education transition."
                  value={form.childSchoolEndAge}
                  onChange={(v) => num("childSchoolEndAge", v)}
                />
                <RefineNumber
                  label="Parental-leave years"
                  hint="Years one income is reduced."
                  value={form.childLeaveYears}
                  onChange={(v) => num("childLeaveYears", v)}
                />
                <Field label="Income drop during leave" hint={`${Math.round(form.childLeaveDrop * 100)}% of household income.`}>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(form.childLeaveDrop * 100)}
                    onChange={(e) => setField("childLeaveDrop", Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
                    className="max-w-[100px] tabular-nums"
                  />
                </Field>
              </>
            )}
          </div>
        )}
        {open && <HousingRefineBlock form={form} setField={setField} currency={currency} />}
        {open && (
          <p className="text-xs text-muted-foreground">
            Current FIRE number: <strong className="tabular-nums">{formatMoney(view.sim.requiredCorpusAtTarget, currency)}</strong>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Pass-2 housing questions: whether the entered spend already covers rent, rent
 * vs own (society fees + property tax instead of rent), and inflation-proof
 * rental income from a second property. Seeds a suggested rent on first open.
 */
function HousingRefineBlock({
  form, setField, currency,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  currency: string;
}) {
  // Seed a suggested rent the first time the housing panel is shown.
  useEffect(() => {
    if (form.housingTouched) return;
    const seed = suggestedMonthlyRent(
      form.retirementCountry || form.country,
      form.retirementCity || form.city,
      form.retirementTierOverride,
      form.monthlySpendRetirement,
    );
    setField("monthlyRent", seed);
    setField("housingTouched", true);
    // Seed once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renting = form.housingChoice === "rent";
  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <h4 className="text-sm font-semibold">Housing in retirement</h4>
        <p className="text-xs text-muted-foreground">
          Rent and ownership costs are location-specific, so they're added on top of your
          cost-of-living-adjusted lifestyle — never scaled by the relocation factor.
        </p>
      </div>

      <Field label="Will you rent or own your home in retirement?">
        <ChoiceGroup
          options={[
            { value: "rent", label: "Rent", hint: "Pay monthly rent" },
            { value: "own", label: "Own", hint: "Society fees + property tax, no rent" },
          ] as const}
          value={form.housingChoice}
          onChange={(v) => setField("housingChoice", v)}
        />
      </Field>

      {renting ? (
        <>
          <Field
            label="Does your monthly spend above already include rent?"
            hint="If yes, we split the rent out before applying the cost-of-living factor, then add it back unscaled."
          >
            <ChoiceGroup
              options={[
                { value: "yes", label: "Yes, it includes rent" },
                { value: "no", label: "No, add rent on top" },
              ] as const}
              value={form.housingIncludesRent ? "yes" : "no"}
              onChange={(v) => setField("housingIncludesRent", v === "yes")}
            />
          </Field>
          <Field label={`Monthly rent (${currency})`} hint="Seeded from the retirement city's cost tier — adjust freely.">
            <MoneyInput
              value={form.monthlyRent}
              onChange={(v) => setField("monthlyRent", v)}
              currency={currency}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={`Monthly society / maintenance fees (${currency})`} hint="Recurring upkeep on the home you own.">
            <MoneyInput
              value={form.monthlySocietyFees}
              onChange={(v) => setField("monthlySocietyFees", v)}
              currency={currency}
            />
          </Field>
          <Field label={`Annual property tax (${currency})`}>
            <MoneyInput
              value={form.annualPropertyTax}
              onChange={(v) => setField("annualPropertyTax", v)}
              currency={currency}
            />
          </Field>
        </>
      )}

      <Field
        label={`Rental income from a second property (${currency}/month)`}
        hint="Inflation-proof, real income — reduces the corpus you need. Use 0 if none."
      >
        <MoneyInput
          value={form.monthlyRentalIncome}
          onChange={(v) => setField("monthlyRentalIncome", v)}
          currency={currency}
        />
      </Field>
    </div>
  );
}

/**
 * Full downloadable PDF report. Gated on the second pass: until the user has
 * answered the housing questions in the refine panel (`housingTouched`), it
 * explains that a few more answers are needed; afterwards it offers the download.
 */
function ReportCard({
  view, form, currency,
}: {
  view: FireView;
  form: FormState;
  currency: string;
}) {
  const ready = form.housingTouched;
  const onDownload = () => {
    const html = buildFireReportHtml(form, view, currency, new Date().toLocaleString());
    printHtmlAsPdf(html);
  };
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" /> Full downloadable report
        </h3>
        {ready ? (
          <>
            <p className="text-xs text-muted-foreground">
              Your plan is complete. Download a full PDF with every assumption and the logic applied —
              the cost-of-living / PPP factor, your housing model, dependants, risk, and sensitivities.
            </p>
            <Button onClick={onDownload}>
              <Download className="h-4 w-4" /> Download PDF report
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            To get a full downloadable report, a few more questions need answering first. Open{" "}
            <strong>“Refine the assumptions”</strong> above and complete the{" "}
            <strong>Housing in retirement</strong> section (rent vs own, and any rental income).
            The report unlocks here once you do.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RefineNumber({
  label, hint, value, onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={120}
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="max-w-[120px] text-lg tabular-nums"
      />
    </Field>
  );
}

// ---------- Tiny presentational helpers ----------

function SectionHeading({ title }: { title: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>;
}

function Field({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function MoneyInput({
  value, onChange, currency, testId,
}: {
  value: number;
  onChange: (v: number) => void;
  currency: string;
  /** Optional data-testid for the demo rig; not used in production. */
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{currency}</span>
      <Input
        data-testid={testId}
        type="number"
        inputMode="decimal"
        min={0}
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="max-w-[220px] text-lg tabular-nums"
      />
    </div>
  );
}

function ChoiceGroup<T extends string>({
  options, value, onChange,
}: {
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md border px-3 py-2 text-left text-sm transition-colors",
            value === opt.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-input hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <div className="font-medium">{opt.label}</div>
          {opt.hint && <div className="text-[11px] text-muted-foreground">{opt.hint}</div>}
        </button>
      ))}
    </div>
  );
}

function Chip({
  selected, onClick, children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
