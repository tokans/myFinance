/* Comprehensive tests for the form→sim adapter. Run: npx tsx scripts/test-fireform.ts */
import {
  buildFireInputs,
  buildFireView,
  type DependantDraft,
  type FireForm,
} from "../src/domain/fireForm";
import { dependantCostAtUserAge } from "../src/domain/fireSim";
import { locationCostFactor } from "../src/domain/locationCost";
import { cityCostIndex, cityCostTier } from "../src/lib/cityCost";
import { priceLevelForCountry } from "../src/lib/countryCurrency";

const approx = (a: number, b: number, eps = 1) => Math.abs(a - b) < eps;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const NOW = 2026;
let _id = 0;
const dep = (type: DependantDraft["type"], age: number, future = false): DependantDraft =>
  ({ id: `d${_id++}`, type, age, future });

const base: FireForm = {
  household: "single_income_no_dep",
  currentAge: 35,
  targetAge: 55,
  currentNetWorth: 100_000,
  annualIncome: 80_000,
  annualSavings: 20_000,
  monthlySpendRetirement: 4_000, // 48k/yr
  retirementSpendIncludesDependants: true,
  dependantMonthlyCost: 0,
  annualGuaranteedIncome: 0,
  risk: "moderate",
  dependants: [],
  newGoals: [],
  expectSecondIncome: false,
  secondIncomeAtAge: 0,
  userLifeExpectancy: 80,
  childIndependenceAge: 25,
  dependantLifeExpectancy: 80,
  marriagePartnerIncome: null,
  childLeaveYears: 1,
  childLeaveDrop: 0.5,
  childUpkeepMonthly: 0,
  childSchoolMonthly: 0,
  childCollegeAnnual: 0,
  childSchoolStartAge: 4,
  childSchoolEndAge: 18,
  // Location & housing — neutral defaults (factor 1, no rent/own/rental costs)
  // so the corpus matches the pre-feature behaviour until a location is chosen.
  country: "IN",
  city: "Mumbai",
  retirementCountry: "",
  retirementCity: "",
  homeTierOverride: null,
  retirementTierOverride: null,
  manualLocationFactorPct: null,
  housingIncludesRent: true,
  housingChoice: "rent",
  monthlyRent: 0,
  monthlySocietyFees: 0,
  annualPropertyTax: 0,
  monthlyRentalIncome: 0,
};

// =================== Household: no dependants never produce future dependants ===================
for (const household of ["single_income_no_dep", "double_income_no_dep"] as const) {
  const f: FireForm = { ...base, household, dependants: [] };
  const inp = buildFireInputs(f, NOW);
  check(`${household}: no dependants in sim`, inp.dependants.length === 0);
  check(`${household}: no events by default`, inp.events.length === 0);
}

// =================== Fix 1: single-income asks for future second income (marriage) ===================
{
  // No second income → no marriage event.
  const noSecond = buildFireInputs({ ...base, household: "single_income_no_dep", expectSecondIncome: false }, NOW);
  check("single_income, no second income → no marriage event", noSecond.events.length === 0);

  // Second income at age 38 → marriage event 3 years out, partner income defaults to doubling.
  const withSecond = buildFireInputs(
    { ...base, household: "single_income_no_dep", expectSecondIncome: true, secondIncomeAtAge: 38 },
    NOW,
  );
  const ev = withSecond.events.find((e) => e.kind === "marriage");
  check("single_income + second income → marriage event exists", !!ev);
  check("marriage event timed at age 38 (3 yrs out)", ev?.yearsFromNow === 3, `${ev?.yearsFromNow}`);
  check("partner income defaults to doubling (= annualIncome)", ev?.partnerAnnualIncome === base.annualIncome, `${ev?.partnerAnnualIncome}`);

  // Explicit partner income override.
  const override = buildFireInputs(
    { ...base, expectSecondIncome: true, secondIncomeAtAge: 38, marriagePartnerIncome: 30_000 },
    NOW,
  );
  check("explicit partner income honoured", override.events.find((e) => e.kind === "marriage")?.partnerAnnualIncome === 30_000);

  // Second income brings FIRE earlier.
  const fAge = (form: FireForm) => buildFireView(form, NOW).sim.fireAgeAtCurrentSavings ?? 999;
  const earlier = fAge({ ...base, expectSecondIncome: true, secondIncomeAtAge: 38 });
  const baseline = fAge({ ...base, expectSecondIncome: false });
  check("second income → earlier (or equal) FIRE", earlier <= baseline, `${earlier} vs ${baseline}`);
  console.log(`  single-income FIRE: with 2nd income ${earlier}, without ${baseline}`);
}

// =================== Fix 1b: single_income_dep also gets the marriage event ===================
{
  const f: FireForm = {
    ...base,
    household: "single_income_dep",
    dependants: [dep("children", 8)],
    childUpkeepMonthly: 500,
    expectSecondIncome: true,
    secondIncomeAtAge: 40,
  };
  const inp = buildFireInputs(f, NOW);
  check("single_income_dep: marriage event present", inp.events.some((e) => e.kind === "marriage"));
  check("single_income_dep: marriage timed at 40 (5 yrs)", inp.events.find((e) => e.kind === "marriage")?.yearsFromNow === 5);
}

// =================== Double-income ignores the second-income flag ===================
for (const household of ["double_income_no_dep", "double_income_dep"] as const) {
  const f: FireForm = {
    ...base,
    household,
    dependants: household === "double_income_dep" ? [dep("parents", 70)] : [],
    dependantMonthlyCost: household === "double_income_dep" ? 1_000 : 0,
    expectSecondIncome: true, // should be ignored — not single income
    secondIncomeAtAge: 40,
  };
  const inp = buildFireInputs(f, NOW);
  check(`${household}: no marriage event despite flag`, !inp.events.some((e) => e.kind === "marriage"));
}

// =================== Marriage is NOT created from a goal (only the explicit question) ===================
{
  const f: FireForm = {
    ...base,
    expectSecondIncome: false,
    newGoals: [{ kind: "marriage", target_date: "2030-06-01" }],
  };
  const inp = buildFireInputs(f, NOW);
  check("legacy marriage goal does NOT create an income event", !inp.events.some((e) => e.kind === "marriage"));
}

// =================== Child goal drives a child event + dependant ===================
{
  const f: FireForm = {
    ...base,
    household: "double_income_no_dep",
    newGoals: [{ kind: "child", target_date: "2029-01-01" }], // 3 yrs out
    childUpkeepMonthly: 500,
    childLeaveYears: 2,
    childLeaveDrop: 0.4,
  };
  const inp = buildFireInputs(f, NOW);
  const ev = inp.events.find((e) => e.kind === "child");
  check("child goal → child event", !!ev);
  check("child event timing 3 yrs out", ev?.yearsFromNow === 3, `${ev?.yearsFromNow}`);
  check("child event carries leave params", ev?.leaveYears === 2 && ev?.leaveIncomeDrop === 0.4);
  const born = inp.dependants.find((d) => d.type === "children");
  check("born child added as dependant (currentAge = -3)", born?.currentAge === -3, `${born?.currentAge}`);
  // Future child's costs (set via refine panel) apply once born: upkeep 500/mo = 6k/yr.
  // Born 3 yrs out → at user age 38 the child is age 0 and upkeep is active.
  check("future child upkeep active at birth", dependantCostAtUserAge([born!], 35, 38) === 6_000, `${dependantCostAtUserAge([born!], 35, 38)}`);
  check("future child no cost before birth", dependantCostAtUserAge([born!], 35, 37) === 0);
}

// =================== Phased child cost (upkeep + school + college) ===================
{
  const f: FireForm = {
    ...base,
    household: "double_income_dep",
    dependants: [dep("children", 5)],
    childUpkeepMonthly: 500,    // 6k/yr, ages 0..25
    childSchoolMonthly: 1_000,  // 12k/yr, ages 4..18
    childCollegeAnnual: 30_000, // ages 18..25
  };
  const inp = buildFireInputs(f, NOW);
  const child = inp.dependants.find((d) => d.type === "children")!;
  // child age 5 (user 35): upkeep + school = 18k.
  check("child cost @ age 5 = upkeep + school", dependantCostAtUserAge([child], 35, 35) === 18_000, `${dependantCostAtUserAge([child], 35, 35)}`);
  // child age 20 (user 50): upkeep + college = 36k.
  check("child cost @ age 20 = upkeep + college", dependantCostAtUserAge([child], 35, 50) === 36_000, `${dependantCostAtUserAge([child], 35, 50)}`);
  // child age 25 (user 55): independent = 0.
  check("child cost @ age 25 = 0", dependantCostAtUserAge([child], 35, 55) === 0);
}

// =================== Spend-basis: includes vs adds dependant costs ===================
{
  const withChild: FireForm = {
    ...base,
    household: "double_income_dep",
    dependants: [dep("children", 5)],
    childUpkeepMonthly: 500,    // 6k
    childSchoolMonthly: 1_000,  // 12k → 18k active now
    monthlySpendRetirement: 4_000, // 48k
  };
  const incl = buildFireInputs({ ...withChild, retirementSpendIncludesDependants: true }, NOW);
  check("includes basis: base = spend − current dependant cost", incl.retirementBaseAnnual === 48_000 - 18_000, `${incl.retirementBaseAnnual}`);
  const excl = buildFireInputs({ ...withChild, retirementSpendIncludesDependants: false }, NOW);
  check("own-only basis: base = full spend", excl.retirementBaseAnnual === 48_000, `${excl.retirementBaseAnnual}`);
}

// =================== Non-child dependant cost split across current dependants ===================
{
  const f: FireForm = {
    ...base,
    household: "double_income_dep",
    dependants: [dep("parents", 70), dep("parents", 72)],
    dependantMonthlyCost: 2_000, // 24k/yr total → 12k each
    retirementSpendIncludesDependants: false,
  };
  const inp = buildFireInputs(f, NOW);
  const parents = inp.dependants.filter((d) => d.type === "parents");
  check("two parents present", parents.length === 2);
  check("cost split evenly (12k each)", parents.every((p) => p.segments[0].annualCost === 12_000), JSON.stringify(parents.map((p) => p.segments[0].annualCost)));
  // Both active now (70,72 < 80) → 24k.
  check("both parents active now → 24k", dependantCostAtUserAge(parents, 35, 35) === 24_000);
}

// =================== Future parent: cost switches on at 75, not now ===================
{
  const f: FireForm = {
    ...base,
    household: "double_income_dep",
    dependants: [dep("parents", 60, true)], // future
    dependantMonthlyCost: 1_000, // 12k/yr
  };
  const inp = buildFireInputs(f, NOW);
  const p = inp.dependants.find((d) => d.type === "parents")!;
  check("future parent segment starts at 75", p.segments[0].fromAge === 75, `${p.segments[0].fromAge}`);
  check("future parent: no cost today (age 60)", dependantCostAtUserAge([p], 35, 35) === 0);
  // User 50 → parent 75 → active.
  check("future parent: cost active at 75 (user 50)", dependantCostAtUserAge([p], 35, 50) === 12_000);
  // includes-basis backout should NOT remove future (not active now).
  check("future parent not backed out of base now", inp.retirementBaseAnnual === 48_000, `${inp.retirementBaseAnnual}`);
}

// =================== Future parent already past 75: switch year is asked & honoured ===================
{
  // Future parent currently 78 (already past the default 75 switch). Without a
  // switch year, the default max(75, age) collapses to "now" (age 78).
  const noYear = buildFireInputs({
    ...base, household: "double_income_dep",
    dependants: [dep("parents", 78, true)], dependantMonthlyCost: 1_000,
  }, NOW);
  const pNoYear = noYear.dependants.find((d) => d.type === "parents")!;
  check("past-75 future parent w/o year → starts now (age 78)", pNoYear.segments[0].fromAge === 78, `${pNoYear.segments[0].fromAge}`);

  // With an explicit switch year 4 years out → support starts at age 82.
  const d82 = { ...dep("parents", 78, true), supportFromYear: NOW + 4 };
  const withYear = buildFireInputs({
    ...base, household: "double_income_dep",
    dependants: [d82], dependantMonthlyCost: 1_000,
  }, NOW);
  const p = withYear.dependants.find((d) => d.type === "parents")!;
  check("switch year honoured → fromAge = 82", p.segments[0].fromAge === 82, `${p.segments[0].fromAge}`);
  check("past-75 future parent: no cost today (age 78)", dependantCostAtUserAge([p], 35, 35) === 0);
  // User 39 → parent 82 → active.
  check("past-75 future parent: cost active at switch year (user 39)", dependantCostAtUserAge([p], 35, 39) === 12_000, `${dependantCostAtUserAge([p], 35, 39)}`);

  // A switch year in the past is clamped to now (can't start before today).
  const dPast = { ...dep("parents", 78, true), supportFromYear: NOW - 5 };
  const past = buildFireInputs({
    ...base, household: "double_income_dep",
    dependants: [dPast], dependantMonthlyCost: 1_000,
  }, NOW);
  const pPast = past.dependants.find((d) => d.type === "parents")!;
  check("past switch year clamped to now (age 78)", pPast.segments[0].fromAge === 78, `${pPast.segments[0].fromAge}`);

  // switchYear is ignored for a future parent still under 75 (default applies).
  const dUnder = { ...dep("parents", 60, true), supportFromYear: NOW + 1 };
  const under = buildFireInputs({
    ...base, household: "double_income_dep",
    dependants: [dUnder], dependantMonthlyCost: 1_000,
  }, NOW);
  const pUnder = under.dependants.find((d) => d.type === "parents")!;
  check("under-75 future parent ignores switch year → still 75", pUnder.segments[0].fromAge === 75, `${pUnder.segments[0].fromAge}`);
}

// =================== Refine: changing assumptions changes corpus ===================
{
  // Parent young enough that the support window overlaps retirement (user 55 → parent 75).
  const f: FireForm = { ...base, household: "double_income_dep", dependants: [dep("parents", 55)], dependantMonthlyCost: 1_000 };
  const longer = buildFireView({ ...f, dependantLifeExpectancy: 90 }, NOW).sim.requiredCorpusAtTarget;
  const shorter = buildFireView({ ...f, dependantLifeExpectancy: 75 }, NOW).sim.requiredCorpusAtTarget;
  check("longer dependant life expectancy → bigger corpus", longer > shorter, `${Math.round(longer)} vs ${Math.round(shorter)}`);

  const lifeLong = buildFireView({ ...base, userLifeExpectancy: 95 }, NOW).sim.requiredCorpusAtTarget;
  const lifeShort = buildFireView({ ...base, userLifeExpectancy: 75 }, NOW).sim.requiredCorpusAtTarget;
  check("longer own life expectancy → bigger corpus", lifeLong > lifeShort, `${Math.round(lifeLong)} vs ${Math.round(lifeShort)}`);
}

// =================== Sensitivity rows present and ordered by return ===================
{
  const v = buildFireView(base, NOW);
  check("3 sensitivity rows", v.sensitivity.length === 3);
  check("base scenario uses chosen risk return (5%)", Math.abs(v.sensitivity[1].realReturn - 0.05) < 1e-9);
  check("conservative corpus ≥ optimistic corpus", v.sensitivity[0].corpus >= v.sensitivity[2].corpus);
}

// =================== City cost index + tier accessors ===================
{
  check("known city resolves index", cityCostIndex("IN", "Mumbai").known && cityCostIndex("IN", "Mumbai").index === 145);
  check("city name matched case-insensitively", cityCostIndex("IN", "mumbai").index === 145);
  const unknown = cityCostIndex("IN", "Nowhereville");
  check("unknown city → fallback 100, known=false", !unknown.known && unknown.index === 100);
  check("tier(100) = medium", cityCostTier(100) === "medium");
  check("tier(80) = low", cityCostTier(80) === "low");
  check("tier(145) = high", cityCostTier(145) === "high");
}

// =================== locationCostFactor: each basis ===================
{
  const li = {
    homeCountry: "IN", homeCity: "Mumbai", retirementCountry: "", retirementCity: "",
    retirementUndecided: true, manualLocationFactorPct: null,
    homeTierOverride: null, retirementTierOverride: null,
  };
  check("undecided → factor 1 (none)", locationCostFactor(li).factor === 1 && locationCostFactor(li).basis === "none");
  const sameCur = locationCostFactor({ ...li, retirementUndecided: false, retirementCountry: "IN", retirementCity: "Indore" });
  check("same-currency → COL ratio (80/145)", approx(sameCur.factor, 80 / 145, 1e-6) && sameCur.basis === "col");
  const cross = locationCostFactor({ ...li, homeCountry: "US", homeCity: "New York", retirementUndecided: false, retirementCountry: "GB", retirementCity: "London" });
  check("cross-currency → PPP ratio (88/100)", approx(cross.factor, priceLevelForCountry("GB")! / priceLevelForCountry("US")!, 1e-6) && cross.basis === "ppp");
  const manual = locationCostFactor({ ...li, retirementUndecided: false, retirementCountry: "US", manualLocationFactorPct: 50 });
  check("manual override wins (0.5)", manual.factor === 0.5 && manual.basis === "manual");
  const clamped = locationCostFactor({ ...li, retirementUndecided: false, retirementCountry: "US", manualLocationFactorPct: 1000 });
  check("manual override clamps to 3.0", clamped.factor === 3.0);
}

// =================== Location factor folds into retirementBaseAnnual ===================
{
  // Neutral default (no retirement country) → unchanged base = full spend.
  check("neutral default base = full spend", buildFireInputs(base, NOW).retirementBaseAnnual === 48_000);
  // Same city, same currency → factor 1.
  check("same-city base = full spend", buildFireInputs({ ...base, retirementCountry: "IN", retirementCity: "Mumbai" }, NOW).retirementBaseAnnual === 48_000);
  // Cheaper city → scaled lifestyle.
  const cheaper = buildFireInputs({ ...base, retirementCountry: "IN", retirementCity: "Indore" }, NOW).retirementBaseAnnual;
  check("cheaper city scales lifestyle (48k × 80/145)", approx(cheaper, 48_000 * (80 / 145)) && cheaper < 48_000, `${cheaper}`);
  // Manual override exact.
  check("manual 50% → base 24k", buildFireInputs({ ...base, retirementCountry: "US", manualLocationFactorPct: 50 }, NOW).retirementBaseAnnual === 24_000);
  check("manual clamp 1000% → base 144k", buildFireInputs({ ...base, retirementCountry: "US", manualLocationFactorPct: 1000 }, NOW).retirementBaseAnnual === 144_000);
}

// =================== Housing: rent vs own, embedded vs added, unscaled ===================
{
  // Rent added on top (spend excludes rent).
  const added = buildFireInputs({ ...base, housingIncludesRent: false, housingChoice: "rent", monthlyRent: 1_000 }, NOW).retirementBaseAnnual;
  check("rent added on top → 48k + 12k", added === 60_000, `${added}`);
  // Rent embedded at factor 1 → no net change.
  const embedded = buildFireInputs({ ...base, housingIncludesRent: true, housingChoice: "rent", monthlyRent: 1_000 }, NOW).retirementBaseAnnual;
  check("rent embedded at factor 1 → unchanged 48k", embedded === 48_000, `${embedded}`);
  // Rent embedded at factor 0.5 → lifestyle scaled, rent unscaled.
  const embScaled = buildFireInputs({ ...base, retirementCountry: "US", manualLocationFactorPct: 50, housingIncludesRent: true, housingChoice: "rent", monthlyRent: 1_000 }, NOW).retirementBaseAnnual;
  check("rent stays unscaled while lifestyle halves ((48k-12k)×0.5 + 12k)", embScaled === (48_000 - 12_000) * 0.5 + 12_000, `${embScaled}`);
  // Own home → society fees + property tax, rent ignored.
  const own = buildFireInputs({ ...base, housingChoice: "own", monthlySocietyFees: 200, annualPropertyTax: 3_000, monthlyRent: 1_000 }, NOW).retirementBaseAnnual;
  check("own home → 48k + 2.4k + 3k (rent ignored)", own === 53_400, `${own}`);
}

// =================== Dependant cost stripped BEFORE scaling (corrected ordering) ===================
{
  const withChild: FireForm = {
    ...base, household: "double_income_dep", dependants: [dep("children", 5)],
    childUpkeepMonthly: 500, childSchoolMonthly: 1_000, // 18k active now
    retirementCountry: "US", manualLocationFactorPct: 50,
  };
  // own-lifestyle = (48k − 18k dep) × 0.5 = 15k; deps re-added by the sim, unscaled.
  check("deps stripped before scaling → (48k−18k)×0.5 = 15k", buildFireInputs(withChild, NOW).retirementBaseAnnual === 15_000, `${buildFireInputs(withChild, NOW).retirementBaseAnnual}`);
}

// =================== Second-property rental income → guaranteed income ===================
{
  const inp = buildFireInputs({ ...base, monthlyRentalIncome: 500 }, NOW);
  check("rental income folds into guaranteed income (+6k)", inp.annualGuaranteedIncome === 6_000, `${inp.annualGuaranteedIncome}`);
  const withRent = buildFireView({ ...base, monthlyRentalIncome: 500 }, NOW).sim.requiredCorpusAtTarget;
  const without = buildFireView(base, NOW).sim.requiredCorpusAtTarget;
  check("rental income lowers required corpus", withRent < without, `${Math.round(withRent)} vs ${Math.round(without)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
