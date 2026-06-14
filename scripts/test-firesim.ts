/* Ad-hoc validation for the FIRE simulation. Run: npx tsx scripts/test-firesim.ts */
import {
  computeFireSim,
  requiredCorpusAt,
  dependantCostAtUserAge,
  type FireSimInputs,
  type SimDependant,
} from "../src/domain/fireSim";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

// --- Base case: no dependants, flat income, retire at 50, die at 80. ---
const base: FireSimInputs = {
  currentAge: 35,
  userLifeExpectancy: 80,
  targetAge: 50,
  currentNetWorth: 200_000,
  annualIncome: 100_000,
  annualSavings: 40_000,
  retirementBaseAnnual: 40_000,
  annualGuaranteedIncome: 0,
  dependants: [],
  events: [],
  risk: "moderate", // realReturn 0.05
};

const basePlan = computeFireSim(base);
// Required corpus at 50 = PV of 40k/yr for ages 50..80 at 5% real.
const corpus50 = requiredCorpusAt(base, 50, 0.05);
check("base corpus matches plan", Math.abs(corpus50 - basePlan.requiredCorpusAtTarget) < 1, `${corpus50} vs ${basePlan.requiredCorpusAtTarget}`);
// PV of 40k for 31 yrs (50..80) at 5% should be ~ 40k * annuity. Sanity: between 600k and 700k.
check("base corpus in sane range", corpus50 > 600_000 && corpus50 < 720_000, `${Math.round(corpus50)}`);
check("base has a FIRE age", basePlan.fireAgeAtCurrentSavings != null, `${basePlan.fireAgeAtCurrentSavings}`);
console.log(`  base: corpus@50=${Math.round(corpus50)}, fireAge=${basePlan.fireAgeAtCurrentSavings?.toFixed(1)}, extra/mo=${Math.round(basePlan.requiredAdditionalMonthlySavings)}`);

// --- Dependant tapering: a child aged 10 costing 12k/yr until independence at 25. ---
const withKid: FireSimInputs = {
  ...base,
  dependants: [
    { type: "children", currentAge: 10, segments: [{ fromAge: 10, toAge: 25, annualCost: 12_000 }] },
  ],
};
// At user age 35 (kid 10): active. At user age 50 (kid 25): NOT active (>= endAge). At 49 (kid 24): active.
check("kid cost active now", dependantCostAtUserAge(withKid.dependants, 35, 35) === 12_000);
check("kid cost gone at independence", dependantCostAtUserAge(withKid.dependants, 35, 50) === 0);
check("kid cost active at 24", dependantCostAtUserAge(withKid.dependants, 35, 49) === 12_000);
const corpusKid = requiredCorpusAt(withKid, 50, 0.05);
// Kid is independent by retirement (25 at user-age 50), so corpus@50 should equal base corpus.
check("kid independent by retirement → corpus unchanged", Math.abs(corpusKid - corpus50) < 1, `${Math.round(corpusKid)} vs ${Math.round(corpus50)}`);

// --- Dependant that overlaps retirement: a parent aged 60, life exp 80, costs 15k. ---
const withParent: FireSimInputs = {
  ...base,
  dependants: [
    { type: "parents", currentAge: 60, segments: [{ fromAge: 60, toAge: 80, annualCost: 15_000 }] },
  ],
};
// Parent is 60 now; at user age 50, parent is 75 → still active (<80). Raises corpus.
const corpusParent = requiredCorpusAt(withParent, 50, 0.05);
check("parent support raises corpus", corpusParent > corpus50, `${Math.round(corpusParent)} vs ${Math.round(corpus50)}`);
// Parent dies (age 80) when user is 55; cost only for ages 50..54 → modest uplift.
check("parent uplift bounded", corpusParent - corpus50 < 15_000 * 6, `${Math.round(corpusParent - corpus50)}`);

// --- Future dependant: parent currently 55, becomes dependent at 70, dies 80. ---
const futureParent: FireSimInputs = {
  ...base,
  dependants: [
    { type: "parents", currentAge: 55, segments: [{ fromAge: 70, toAge: 80, annualCost: 15_000 }] },
  ],
};
// Now (user 35, parent 55): not yet. User 50 → parent 70 → starts. User 60 → parent 80 → ends.
check("future parent not active now", dependantCostAtUserAge(futureParent.dependants, 35, 35) === 0);
check("future parent active at start", dependantCostAtUserAge(futureParent.dependants, 35, 50) === 15_000);
check("future parent ends at life exp", dependantCostAtUserAge(futureParent.dependants, 35, 60) === 0);

// --- Phased child cost: upkeep 0..25, school 4..18, college 18..25 (overlapping bands sum). ---
const phasedChild: SimDependant = {
  type: "children",
  currentAge: 3,
  segments: [
    { fromAge: 0, toAge: 25, annualCost: 6_000 },   // upkeep
    { fromAge: 4, toAge: 18, annualCost: 10_000 },  // school
    { fromAge: 18, toAge: 25, annualCost: 30_000 }, // college
  ],
};
// At child age 3 → upkeep only = 6k.
check("child age 3 = upkeep only", dependantCostAtUserAge([phasedChild], 35, 35) === 6_000);
// At child age 10 (user 42) → upkeep + school = 16k.
check("child age 10 = upkeep + school", dependantCostAtUserAge([phasedChild], 35, 42) === 16_000);
// At child age 20 (user 52) → upkeep + college = 36k.
check("child age 20 = upkeep + college", dependantCostAtUserAge([phasedChild], 35, 52) === 36_000);
// At child age 25 (user 57) → independent = 0.
check("child age 25 = independent", dependantCostAtUserAge([phasedChild], 35, 57) === 0);

// --- Marriage income event: single income 60k, partner doubles at year 3. ---
const marriage: FireSimInputs = {
  ...base,
  annualIncome: 60_000,
  annualSavings: 10_000,
  events: [{ kind: "marriage", yearsFromNow: 3, partnerAnnualIncome: 60_000 }],
};
const marriagePlan = computeFireSim(marriage);
// Doubling income should make FIRE reachable earlier than a no-marriage equivalent.
const noMarriage = computeFireSim({ ...marriage, events: [] });
const mFire = marriagePlan.fireAgeAtCurrentSavings ?? 999;
const nFire = noMarriage.fireAgeAtCurrentSavings ?? 999;
check("marriage (income doubling) speeds up FIRE", mFire <= nFire, `marriage ${mFire} vs none ${nFire}`);
console.log(`  marriage: fireAge=${marriagePlan.fireAgeAtCurrentSavings?.toFixed(1)}, none=${noMarriage.fireAgeAtCurrentSavings?.toFixed(1)}`);

// --- Child leave event: dual income, one income pauses 2 yrs at 50% → slows FIRE. ---
const child: FireSimInputs = {
  ...base,
  events: [{ kind: "child", yearsFromNow: 2, leaveYears: 2, leaveIncomeDrop: 0.5 }],
};
const childPlan = computeFireSim(child);
const noChild = computeFireSim({ ...child, events: [] });
const cFire = childPlan.fireAgeAtCurrentSavings ?? 0;
const ncFire = noChild.fireAgeAtCurrentSavings ?? 0;
check("child leave (income dip) slows or matches FIRE", cFire >= ncFire, `child ${cFire} vs none ${ncFire}`);

// --- requiredAdditionalMonthlySavings actually closes the gap. ---
const tight: FireSimInputs = { ...base, currentNetWorth: 0, annualSavings: 5_000, targetAge: 45 };
const tightPlan = computeFireSim(tight);
check("tight plan needs extra savings", tightPlan.requiredAdditionalMonthlySavings > 0, `${Math.round(tightPlan.requiredAdditionalMonthlySavings)}`);
// Verify: simulate to target with the extra and confirm NW >= required.
{
  const r = 0.05;
  const workingBase = Math.max(0, tight.annualIncome - tight.annualSavings); // no dependants
  let nw = tight.currentNetWorth;
  const extraAnnual = tightPlan.requiredAdditionalMonthlySavings * 12;
  for (let age = tight.currentAge; age < tight.targetAge; age++) {
    nw = nw * (1 + r) + (tight.annualIncome - workingBase + extraAnnual);
  }
  const req = requiredCorpusAt(tight, tight.targetAge, r);
  check("extra savings reaches required corpus", nw >= req - 1, `nw ${Math.round(nw)} vs req ${Math.round(req)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
