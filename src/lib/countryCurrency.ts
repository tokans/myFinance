/**
 * Maps an ISO 3166-1 alpha-2 country code to the ISO 4217 currency we offer for
 * it. Only covers the currencies in the shared common `currency` master
 * (`sharedcorelib` `getCommonBaked`, plus the eurozone). Returns null when we have
 * no mapping — callers should
 * then leave the user's current currency untouched rather than clobber it.
 */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  IN: "INR",
  US: "USD",
  GB: "GBP",
  SG: "SGD",
  AE: "AED",
  AU: "AUD",
  CA: "CAD",
  JP: "JPY",
  CN: "CNY",
  CH: "CHF",
  HK: "HKD",
  NZ: "NZD",
  ZA: "ZAR",
  SA: "SAR",
  QA: "QAR",
  KW: "KWD",
  MY: "MYR",
  TH: "THB",
  ID: "IDR",
  KR: "KRW",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  BR: "BRL",
  MX: "MXN",
  LK: "LKR",
  BD: "BDT",
  NP: "NPR",
  PK: "PKR",
  // Eurozone members
  AT: "EUR", BE: "EUR", HR: "EUR", CY: "EUR", EE: "EUR", FI: "EUR",
  FR: "EUR", DE: "EUR", GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR",
  LT: "EUR", LU: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SK: "EUR",
  SI: "EUR", ES: "EUR",
};

/** India is the app's default residence and drives the default currency (INR). */
export const DEFAULT_COUNTRY = "IN";

/** Returns the linked currency for a country, or null if we have no mapping. */
export function currencyForCountry(country: string): string | null {
  return COUNTRY_TO_CURRENCY[country] ?? null;
}

/**
 * Comparative price level per country (US = 100), used by the FIRE calculator
 * for purchasing-power-parity (PPP) adjustment when someone builds their corpus
 * in one currency but retires where prices differ. Only ratios of two levels are
 * used, so the US=100 base is just a convenient reference. Approximate, OECD-style
 * figures — good enough to size a corpus, not an FX rate. Eurozone members fall
 * back to `EUROZONE_PRICE_LEVEL` when not listed individually.
 */
const COUNTRY_PRICE_LEVEL: Record<string, number> = {
  US: 100, CH: 130, NO: 120, DK: 118, IS: 120, AU: 100, NZ: 95, CA: 92,
  GB: 88, JP: 95, SG: 95, HK: 98, KR: 84, IL: 105, AE: 72, QA: 75, SA: 60,
  KW: 65, SE: 100, IN: 28, CN: 55, ID: 38, TH: 48, MY: 45, VN: 38, PH: 42,
  LK: 32, BD: 38, NP: 35, PK: 30, BR: 55, MX: 58, ZA: 50, RU: 42, TR: 40,
  // Eurozone members (override the EUROZONE_PRICE_LEVEL fallback)
  DE: 95, FR: 98, NL: 100, IE: 110, IT: 88, ES: 80, PT: 78, GR: 75, FI: 105,
  AT: 98, BE: 100, LU: 110,
};

/** Default price level applied to eurozone members not listed in COUNTRY_PRICE_LEVEL. */
const EUROZONE_PRICE_LEVEL = 90;

const EUROZONE = new Set([
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV",
  "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
]);

/** Comparative price level for a country (US=100), or null if unknown. */
export function priceLevelForCountry(country: string): number | null {
  if (country in COUNTRY_PRICE_LEVEL) return COUNTRY_PRICE_LEVEL[country];
  if (EUROZONE.has(country)) return EUROZONE_PRICE_LEVEL;
  return null;
}
