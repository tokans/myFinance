/**
 * Where you retire changes what your retirement costs. This module turns the
 * wizard's location answers into a single `locationCostFactor` — how much
 * cheaper or dearer the retirement location is than where you live today — plus
 * a tier-based rent suggestion. Pure and unit-testable (see scripts/test-fireform.ts).
 *
 * The factor scales only the **non-rent lifestyle** portion of retirement spend
 * (rent and ownership costs are entered as retirement-location figures and are
 * never scaled). It is built from, in priority order:
 *   1. a manual % override the user typed (wins outright),
 *   2. PPP price-level ratio when retiring in a different-currency country,
 *   3. the city cost-of-living index ratio when the currency is unchanged.
 */

import {
  cityCostIndex,
  cityCostTier,
  indexForTier,
  type CostTier,
} from "@/lib/cityCost";
import { currencyForCountry, priceLevelForCountry } from "@/lib/countryCurrency";

/** Guards against a bad/missing data row producing an absurd corpus. */
export const FACTOR_MIN = 0.3;
export const FACTOR_MAX = 3.0;

export interface LocationCostInputs {
  homeCountry: string;
  homeCity: string;
  retirementCountry: string;
  retirementCity: string;
  /** True when the user hasn't decided where to retire — no relocation modelled. */
  retirementUndecided: boolean;
  /** Manual override, e.g. 70 → factor 0.70. null/≤0 → auto. */
  manualLocationFactorPct: number | null;
  /** Tier overrides for cities not in the index (null = use detected). */
  homeTierOverride: CostTier | null;
  retirementTierOverride: CostTier | null;
}

const clampFactor = (f: number): number =>
  Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, f));

/** COL index for a side, honouring a manual tier override. */
function resolveIndex(
  country: string,
  city: string,
  override: CostTier | null,
): number {
  if (override) return indexForTier(override);
  return cityCostIndex(country, city).index;
}

/** Whether the retirement location uses a different currency than home. */
export function isCrossCurrency(homeCountry: string, retirementCountry: string): boolean {
  const homeCur = currencyForCountry(homeCountry);
  const retCur = currencyForCountry(retirementCountry);
  return !!homeCur && !!retCur && homeCur !== retCur;
}

export interface LocationFactor {
  factor: number;
  /** What drove the factor — for labelling the UI. */
  basis: "manual" | "ppp" | "col" | "none";
}

/** The unified cost-of-living factor (with the basis that produced it). */
export function locationCostFactor(inp: LocationCostInputs): LocationFactor {
  // 1. Manual override always wins.
  if (inp.manualLocationFactorPct != null && inp.manualLocationFactorPct > 0) {
    return { factor: clampFactor(inp.manualLocationFactorPct / 100), basis: "manual" };
  }

  // 2. Undecided or no retirement country → no relocation modelled.
  if (inp.retirementUndecided || !inp.retirementCountry) {
    return { factor: 1, basis: "none" };
  }

  const homeIdx = resolveIndex(inp.homeCountry, inp.homeCity, inp.homeTierOverride);
  const retIdx = resolveIndex(inp.retirementCountry, inp.retirementCity, inp.retirementTierOverride);

  // 3. Cross-currency → PPP price-level ratio is the base factor.
  if (isCrossCurrency(inp.homeCountry, inp.retirementCountry)) {
    const homePL = priceLevelForCountry(inp.homeCountry);
    const retPL = priceLevelForCountry(inp.retirementCountry);
    if (homePL && retPL && homePL > 0) {
      return { factor: clampFactor(retPL / homePL), basis: "ppp" };
    }
    // PPP data missing → fall back to COL index ratio.
    if (homeIdx > 0) return { factor: clampFactor(retIdx / homeIdx), basis: "col" };
    return { factor: 1, basis: "none" };
  }

  // 4. Same currency → city COL ratio only.
  if (homeIdx > 0) return { factor: clampFactor(retIdx / homeIdx), basis: "col" };
  return { factor: 1, basis: "none" };
}

/**
 * A rough monthly-rent seed for the retirement location: a tier-scaled fraction
 * of total monthly spend. Only a starting value — the user edits it in pass 2.
 */
export function suggestedMonthlyRent(
  retirementCountry: string,
  retirementCity: string,
  retirementTierOverride: CostTier | null,
  monthlySpend: number,
): number {
  const idx = retirementTierOverride
    ? indexForTier(retirementTierOverride)
    : cityCostIndex(retirementCountry, retirementCity).index;
  const tier = cityCostTier(idx);
  const frac = tier === "low" ? 0.2 : tier === "high" ? 0.4 : 0.3;
  return Math.round(Math.max(0, monthlySpend) * frac);
}
