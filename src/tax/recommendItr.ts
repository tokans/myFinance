/**
 * ITR form recommendation. Advisory only — the decision tree is based on the
 * Income Tax Department's published eligibility criteria for AY 2026-27.
 *
 * Disclaimer (surfaced in the UI too): this is informational; verify with a
 * Chartered Accountant before filing. Edge cases (HUF rules, NRI rules, complex
 * income types) are not exhaustively covered.
 */

import type { ItrForm } from "@/db/tax";

export interface WizardInputs {
  /** Total annual income (gross). ₹50L threshold matters. */
  totalIncome: number | null;
  /** True if assessee is an individual; false for HUF/firm etc. */
  isIndividual: boolean;
  /** Resident for tax purposes? */
  isResident: boolean;
  /** Any business or professional income? */
  hasBusinessIncome: boolean;
  /** If yes — does it qualify for presumptive scheme 44AD/44ADA/44AE? */
  hasPresumptiveOnly: boolean;
  /** Any capital gains (short or long term)? */
  hasCapitalGains: boolean;
  /** More than one house property? */
  hasMultipleHouses: boolean;
  /** Foreign assets / foreign income? */
  hasForeignAssetsOrIncome: boolean;
  /** Director in any company during the year? */
  isDirector: boolean;
  /** Held unlisted equity shares during the year? */
  hasUnlistedShares: boolean;
  /** Agricultural income > ₹5,000? */
  agriIncomeAbove5000: boolean;
  /** Lottery / horse race / gambling winnings? */
  hasWinnings: boolean;
  /** Brought-forward losses to set off? */
  hasBroughtForwardLosses: boolean;
}

export interface Recommendation {
  form: ItrForm | null;
  /** Plain-English bullets of why. */
  reasons: string[];
  /** Whether the user is disqualified from ITR-1. */
  blockedFromItr1: string[];
  /** Whether the user might need ITR-3 instead of ITR-4. */
  blockedFromItr4: string[];
}

const ITR1_LIMIT = 5_000_000;        // ₹50 lakh
const ITR4_LIMIT = 5_000_000;        // ₹50 lakh

export function recommendItr(input: WizardInputs): Recommendation {
  const blockedFromItr1: string[] = [];
  const blockedFromItr4: string[] = [];

  if (!input.isIndividual) {
    blockedFromItr1.push("Only individuals can file ITR-1.");
    blockedFromItr4.push("Only individuals / HUFs / partnership firms (non-LLP) can file ITR-4.");
  }
  if (!input.isResident) {
    blockedFromItr1.push("Non-residents cannot file ITR-1.");
    blockedFromItr4.push("Non-residents cannot file ITR-4.");
  }
  if (input.totalIncome != null && input.totalIncome > ITR1_LIMIT) {
    blockedFromItr1.push(`Total income exceeds ₹${(ITR1_LIMIT / 100000).toFixed(0)} lakh.`);
  }
  if (input.totalIncome != null && input.totalIncome > ITR4_LIMIT) {
    blockedFromItr4.push(`Total income exceeds ₹${(ITR4_LIMIT / 100000).toFixed(0)} lakh.`);
  }
  if (input.hasCapitalGains) blockedFromItr1.push("Capital gains income reported.");
  if (input.hasMultipleHouses) blockedFromItr1.push("Income from more than one house property.");
  if (input.hasForeignAssetsOrIncome) {
    blockedFromItr1.push("Foreign assets or foreign income.");
    blockedFromItr4.push("Foreign assets or foreign income.");
  }
  if (input.isDirector) {
    blockedFromItr1.push("Director in a company during the year.");
    blockedFromItr4.push("Director in a company during the year.");
  }
  if (input.hasUnlistedShares) {
    blockedFromItr1.push("Held unlisted equity shares during the year.");
    blockedFromItr4.push("Held unlisted equity shares during the year.");
  }
  if (input.agriIncomeAbove5000) blockedFromItr1.push("Agricultural income exceeds ₹5,000.");
  if (input.hasWinnings) blockedFromItr1.push("Winnings from lotteries / horse races.");
  if (input.hasBroughtForwardLosses) {
    blockedFromItr1.push("Brought-forward losses to set off.");
    blockedFromItr4.push("Brought-forward losses to set off.");
  }

  // Business income routing — once you have business income you're ITR-3 or ITR-4 only.
  if (input.hasBusinessIncome) {
    if (input.hasPresumptiveOnly && blockedFromItr4.length === 0) {
      return {
        form: "4",
        reasons: [
          "Business / professional income falls under the presumptive scheme (44AD / 44ADA / 44AE).",
          "Total income is within the ₹50 lakh cap.",
          "No disqualifying conditions detected.",
        ],
        blockedFromItr1,
        blockedFromItr4,
      };
    }
    // Either non-presumptive OR disqualified from ITR-4 → ITR-3.
    const reasons = [
      input.hasPresumptiveOnly
        ? "Business income is under the presumptive scheme but other conditions block ITR-4."
        : "You reported business or professional income that is not under the presumptive scheme.",
      "ITR-3 covers individuals / HUFs with business or professional income.",
    ];
    return {
      form: "3",
      reasons,
      blockedFromItr1: blockedFromItr1.length ? blockedFromItr1 : ["Has business / professional income."],
      blockedFromItr4: blockedFromItr4.length ? blockedFromItr4 : ["Non-presumptive business income — needs full books."],
    };
  }

  if (blockedFromItr1.length === 0) {
    return {
      form: "1",
      reasons: [
        "Income is from salary, at most one house property, and/or other sources.",
        "Total income is within the ₹50 lakh cap.",
        "No disqualifying conditions detected.",
      ],
      blockedFromItr1,
      blockedFromItr4,
    };
  }

  // Default fallback — ITR-2
  return {
    form: "2",
    reasons: [
      "Doesn't fit ITR-1 (see disqualifications below).",
      "No business or professional income reported.",
      "ITR-2 covers individuals / HUFs with non-business income.",
    ],
    blockedFromItr1,
    blockedFromItr4,
  };
}

export const DEFAULT_WIZARD_INPUTS: WizardInputs = {
  totalIncome: null,
  isIndividual: true,
  isResident: true,
  hasBusinessIncome: false,
  hasPresumptiveOnly: false,
  hasCapitalGains: false,
  hasMultipleHouses: false,
  hasForeignAssetsOrIncome: false,
  isDirector: false,
  hasUnlistedShares: false,
  agriIncomeAbove5000: false,
  hasWinnings: false,
  hasBroughtForwardLosses: false,
};
