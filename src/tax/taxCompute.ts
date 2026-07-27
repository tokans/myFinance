/**
 * Deterministic income-tax computation for FY 2025-26 (AY 2026-27), old and new
 * regimes. Advisory only — slab rates, §87A rebate thresholds, surcharge bands
 * and cess are hard-coded from the Finance Act as it stands for this year and
 * MUST be re-verified against the latest law before relying on the numbers. No
 * LLM, no network: pure arithmetic on a taxable-income figure the caller
 * supplies (standard deduction / Chapter VI-A are applied upstream).
 */

export type Regime = "new" | "old";

export interface TaxComputation {
  regime: Regime;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate87A: number;
  taxAfterRebate: number;
  surcharge: number;
  /** Health & education cess @ 4%. */
  cess: number;
  /** Net tax liability (before TDS/advance tax). */
  totalTax: number;
}

interface Slab {
  upTo: number | null; // null = no upper bound
  rate: number; // fraction
}

// FY 2025-26 new regime (default u/s 115BAC).
const NEW_SLABS: Slab[] = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 0.05 },
  { upTo: 1200000, rate: 0.10 },
  { upTo: 1600000, rate: 0.15 },
  { upTo: 2000000, rate: 0.20 },
  { upTo: 2400000, rate: 0.25 },
  { upTo: null, rate: 0.30 },
];

// FY 2025-26 old regime (individual < 60; senior-citizen slabs not modelled).
const OLD_SLABS: Slab[] = [
  { upTo: 250000, rate: 0 },
  { upTo: 500000, rate: 0.05 },
  { upTo: 1000000, rate: 0.20 },
  { upTo: null, rate: 0.30 },
];

function slabTax(income: number, slabs: Slab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    if (income > lower) {
      const taxableInBand = Math.min(income, upper) - lower;
      tax += taxableInBand * s.rate;
    }
    lower = upper;
    if (income <= upper) break;
  }
  return tax;
}

/** §87A rebate: full tax rebate up to a total-income ceiling, capped. */
function rebate87A(taxableIncome: number, tax: number, regime: Regime): number {
  if (regime === "new") {
    // AY 2026-27: rebate up to ₹12L total income, capped at ₹60,000.
    if (taxableIncome <= 1200000) return Math.min(tax, 60000);
    return 0;
  }
  // Old regime: up to ₹5L, capped at ₹12,500.
  if (taxableIncome <= 500000) return Math.min(tax, 12500);
  return 0;
}

/** Surcharge on income tax by total-income band. New regime caps at 25%. */
function surchargeRate(taxableIncome: number, regime: Regime): number {
  if (taxableIncome <= 5000000) return 0;
  if (taxableIncome <= 10000000) return 0.10;
  if (taxableIncome <= 20000000) return 0.15;
  if (taxableIncome <= 50000000) return 0.25;
  return regime === "new" ? 0.25 : 0.37;
}

export function computeTax(taxableIncome: number, regime: Regime): TaxComputation {
  const income = Math.max(0, Math.round(taxableIncome));
  const slabs = regime === "new" ? NEW_SLABS : OLD_SLABS;
  const taxBeforeRebate = Math.round(slabTax(income, slabs));
  const rebate = rebate87A(income, taxBeforeRebate, regime);
  const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate);
  const surcharge = Math.round(taxAfterRebate * surchargeRate(income, regime));
  const cess = Math.round((taxAfterRebate + surcharge) * 0.04);
  const totalTax = taxAfterRebate + surcharge + cess;
  return {
    regime,
    taxableIncome: income,
    taxBeforeRebate,
    rebate87A: rebate,
    taxAfterRebate,
    surcharge,
    cess,
    totalTax,
  };
}
