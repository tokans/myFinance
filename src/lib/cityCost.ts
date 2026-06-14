/**
 * Baked cost-of-living index per (country, city), used by the FIRE calculator to
 * tier cities (low / medium / high) and to scale retirement spend when the user
 * plans to retire in a different city than they live in today.
 *
 * The index is a relative scalar with **100 = a country-typical city**. Only
 * major metros are listed; any city not present falls back to `FALLBACK_INDEX`
 * (medium tier) and the UI offers a manual low/medium/high override. Because the
 * index is relative *within* the comparison, only ratios of two indices are ever
 * used (see `locationCostFactor`); the absolute base is immaterial.
 *
 * City names are matched case-insensitively and against common alternates
 * (e.g. "Bangalore" / "Bengaluru"), since the city master stores free-form names.
 */

export type CostTier = "low" | "medium" | "high";

/** Per-country city → cost-of-living index (base 100 = country-typical city). */
const CITY_COST: Record<string, Record<string, number>> = {
  IN: {
    Mumbai: 145, Delhi: 130, "New Delhi": 130, Gurgaon: 125, Gurugram: 125,
    Bengaluru: 128, Bangalore: 128, Pune: 110, Hyderabad: 105, Chennai: 105,
    Kolkata: 95, Ahmedabad: 90, Jaipur: 85, Kochi: 92, Indore: 80, Lucknow: 80,
    Chandigarh: 100, Surat: 88, Nagpur: 82, Coimbatore: 85,
  },
  US: {
    "New York": 187, "San Francisco": 190, "San Jose": 175, "Los Angeles": 155,
    Seattle: 150, Boston: 152, "Washington": 140, "Washington DC": 140,
    Chicago: 120, Denver: 122, Austin: 118, Portland: 120, Miami: 125,
    Atlanta: 108, Dallas: 104, Houston: 100, Phoenix: 105, "San Diego": 145,
  },
  GB: {
    London: 165, "Greater London": 165, Oxford: 130, Cambridge: 128,
    Brighton: 120, Bristol: 112, Edinburgh: 115, Manchester: 110, Glasgow: 100,
    Leeds: 100, Birmingham: 102, Liverpool: 95, Sheffield: 92,
  },
  SG: { Singapore: 140 },
  AE: { Dubai: 130, "Abu Dhabi": 120, Sharjah: 95 },
  AU: { Sydney: 150, Melbourne: 135, Brisbane: 118, Perth: 112, Adelaide: 105, Canberra: 125 },
  CA: { Toronto: 140, Vancouver: 145, Montreal: 110, Calgary: 115, Ottawa: 118 },
  DE: { Munich: 135, Frankfurt: 125, Hamburg: 118, Berlin: 115, Cologne: 108, Leipzig: 92 },
  FR: { Paris: 145, Lyon: 110, Nice: 115, Marseille: 100, Toulouse: 98, Bordeaux: 105 },
  ES: { Madrid: 110, Barcelona: 115, Valencia: 92, Seville: 85, Malaga: 90 },
  NL: { Amsterdam: 135, "The Hague": 115, Rotterdam: 110, Utrecht: 118, Eindhoven: 105 },
  JP: { Tokyo: 150, Osaka: 120, Yokohama: 125, Nagoya: 110, Kyoto: 115, Fukuoka: 100 },
};

/** Index assumed for a city not present in the table (country-typical, medium). */
export const FALLBACK_INDEX = 100;

/** Tier cut points on the index scale. */
const LOW_MAX = 95;
const HIGH_MIN = 130;

/**
 * Cost-of-living index for a (country, city). Returns `known: false` with the
 * fallback index when the city isn't in our table, so callers can show a hint
 * and offer a manual tier override.
 */
export function cityCostIndex(country: string, city: string): { index: number; known: boolean } {
  const byCountry = country ? CITY_COST[country] : undefined;
  if (!byCountry || !city) return { index: FALLBACK_INDEX, known: false };
  const exact = byCountry[city];
  if (exact != null) return { index: exact, known: true };
  const lower = city.toLowerCase();
  const ci = Object.entries(byCountry).find(([k]) => k.toLowerCase() === lower);
  return ci ? { index: ci[1], known: true } : { index: FALLBACK_INDEX, known: false };
}

/** Classify an index into low / medium / high. */
export function cityCostTier(index: number): CostTier {
  if (index <= LOW_MAX) return "low";
  if (index >= HIGH_MIN) return "high";
  return "medium";
}

/** Representative index for a manually chosen tier (used for rent + factor when overridden). */
export function indexForTier(tier: CostTier): number {
  return tier === "low" ? 80 : tier === "high" ? 150 : 110;
}

export const COST_TIER_LABEL: Record<CostTier, string> = {
  low: "Low cost",
  medium: "Medium cost",
  high: "High cost",
};
