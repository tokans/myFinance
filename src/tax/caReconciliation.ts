/**
 * Reconciles a Chartered Accountant's tax computation sheet
 * (`db/taxCaComputation.ts`) against this app's own computed tax-year data —
 * a category-PRESENCE diff ("which line items does one side have that the
 * other doesn't"), not a pairwise amount-duplicate detector like
 * `domain/recon.ts`. Deliberately never touches `db/reconLinks.ts` —
 * "confirming" a CA line item here just means teaching the classifier a new
 * keyword (`learnCaLabel`), not excluding a row from any total.
 *
 * A CA sheet's line-item labels are freeform text; this app's own categories
 * are two different kinds of vocabulary:
 *  - FIXED (income heads, payment types, the handful of assessment totals) —
 *    matched via the same evolving keyword engine as
 *    `tax/folderDocClassifier.ts` (`lib/keywordCategoryMatcher.ts`).
 *  - OPEN (deduction sections — "80C", "80D", whatever the importer wrote,
 *    no fixed enum) — matched via the existing fuzzy entity matcher
 *    (`domain/entityMatch.ts`), the same one `domain/recon.ts` already uses
 *    for payer-name matching.
 *
 * Pure, no DB/React (same convention as `domain/recon.ts`) — the only I/O is
 * the two learned-rule persistence functions, which go through the generic
 * settings store like every other "evolving dataset" in this app.
 */
import { getSetting, setSetting } from "@/db/settings";
import type { IncomeHead, PaymentType, TaxAssessment } from "@/db/tax";
import { entitiesMatch } from "@/domain/entityMatch";
import { matchCategory, upsertLearnedRule, type KeywordRule } from "@/lib/keywordCategoryMatcher";
import { HEAD_LABELS, PAYMENT_LABELS } from "./taxLabels";

type AssessmentAmountField =
  | "gross_total_income" | "total_deductions" | "total_income" | "net_tax_liability" | "total_taxes_paid" | "refund_or_balance";

export type SystemTaxCategory =
  | `income:${IncomeHead}`
  | `payment:${PaymentType}`
  | `assessment:${AssessmentAmountField}`;

const ASSESSMENT_LABELS: Record<AssessmentAmountField, string> = {
  gross_total_income: "Gross total income",
  total_deductions: "Total deductions",
  total_income: "Total income",
  net_tax_liability: "Net tax liability",
  total_taxes_paid: "Total taxes paid",
  refund_or_balance: "Refund / balance due",
};

const ASSESSMENT_FIELDS = Object.keys(ASSESSMENT_LABELS) as AssessmentAmountField[];

/** Every fixed category this app knows about, income heads + payment types +
 *  assessment totals — used to enumerate what the CA doc might be missing. */
export const ALL_FIXED_CATEGORIES: SystemTaxCategory[] = [
  ...(Object.keys(HEAD_LABELS) as IncomeHead[]).map((h): SystemTaxCategory => `income:${h}`),
  ...(Object.keys(PAYMENT_LABELS) as PaymentType[]).map((t): SystemTaxCategory => `payment:${t}`),
  ...ASSESSMENT_FIELDS.map((f): SystemTaxCategory => `assessment:${f}`),
];

export function labelForSystemCategory(category: SystemTaxCategory): string {
  const [kind, key] = category.split(":") as [string, string];
  if (kind === "income") return HEAD_LABELS[key as IncomeHead];
  if (kind === "payment") return PAYMENT_LABELS[key as PaymentType];
  return ASSESSMENT_LABELS[key as AssessmentAmountField];
}

function kindOfCategory(category: SystemTaxCategory): "income" | "payment" | "assessment" {
  if (category.startsWith("income:")) return "income";
  if (category.startsWith("payment:")) return "payment";
  return "assessment";
}

/** Starting-point phrasings per fixed category — deliberately chosen to
 *  avoid substring collisions between DIFFERENT categories (e.g. "total
 *  income" is intentionally omitted because it's a substring of "gross
 *  total income"; a bare "Total Income" CA label falls through to the
 *  unclassified/clarify flow rather than risk silently picking the wrong
 *  one of two genuinely different figures). Grows via `learnCaLabel`. */
const BUILTIN_RULES: KeywordRule<SystemTaxCategory>[] = [
  { keyword: "salary", category: "income:salary" },
  { keyword: "house property", category: "income:house_property" },
  { keyword: "rental income", category: "income:house_property" },
  { keyword: "other sources", category: "income:other_sources" },
  { keyword: "interest income", category: "income:other_sources" },
  { keyword: "interest on savings", category: "income:other_sources" },
  { keyword: "dividend", category: "income:dividend" },
  { keyword: "short term capital gain", category: "income:cg_short" },
  { keyword: "stcg", category: "income:cg_short" },
  { keyword: "long term capital gain", category: "income:cg_long" },
  { keyword: "ltcg", category: "income:cg_long" },
  { keyword: "business income", category: "income:business" },
  { keyword: "profession", category: "income:business" },
  { keyword: "professional income", category: "income:business" },
  { keyword: "exempt income", category: "income:exempt" },

  { keyword: "tds on salary", category: "payment:tds_salary" },
  { keyword: "tds salary", category: "payment:tds_salary" },
  { keyword: "tax deducted at source", category: "payment:tds_other" },
  { keyword: "tds on other", category: "payment:tds_other" },
  { keyword: "advance tax", category: "payment:advance" },
  { keyword: "self assessment tax", category: "payment:self_assessment" },
  { keyword: "tax collected at source", category: "payment:tcs" },
  { keyword: "tcs", category: "payment:tcs" },

  { keyword: "gross total income", category: "assessment:gross_total_income" },
  { keyword: "gti", category: "assessment:gross_total_income" },
  { keyword: "total deductions", category: "assessment:total_deductions" },
  { keyword: "chapter vi a deductions", category: "assessment:total_deductions" },
  { keyword: "taxable income", category: "assessment:total_income" },
  { keyword: "net taxable income", category: "assessment:total_income" },
  { keyword: "total tax payable", category: "assessment:net_tax_liability" },
  { keyword: "net tax liability", category: "assessment:net_tax_liability" },
  { keyword: "tax liability", category: "assessment:net_tax_liability" },
  { keyword: "taxes paid", category: "assessment:total_taxes_paid" },
  { keyword: "total taxes paid", category: "assessment:total_taxes_paid" },
  { keyword: "tax already paid", category: "assessment:total_taxes_paid" },
  { keyword: "refund due", category: "assessment:refund_or_balance" },
  { keyword: "refund amount", category: "assessment:refund_or_balance" },
  { keyword: "balance tax payable", category: "assessment:refund_or_balance" },
  { keyword: "balance payable", category: "assessment:refund_or_balance" },
];

export interface LearnedCaLabelRule {
  keyword: string;
  category: SystemTaxCategory;
}

const LEARNED_CA_LABELS_SETTING_KEY = "tax_ca_recon_learned_labels";

export async function loadLearnedCaLabelRules(): Promise<LearnedCaLabelRule[]> {
  const raw = await getSetting(LEARNED_CA_LABELS_SETTING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LearnedCaLabelRule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remembers `keyword` -> `category` for future CA-document reconciliations
 *  (last-write-wins on the same normalized keyword text). No-op for an
 *  empty/whitespace keyword. */
export async function learnCaLabel(keyword: string, category: SystemTaxCategory): Promise<void> {
  if (!keyword.trim()) return;
  const existing = await loadLearnedCaLabelRules();
  const next = upsertLearnedRule(existing, { keyword, category });
  await setSetting(LEARNED_CA_LABELS_SETTING_KEY, JSON.stringify(next));
}

export interface CaReconGap {
  label: string;
  kind: "income" | "payment" | "assessment" | "deduction";
}

export interface CaReconMatch {
  caLabel: string;
  caAmount: number;
  systemLabel: string;
  systemAmount: number;
}

export interface CaReconUnclassified {
  caLabel: string;
  caAmount: number;
  /** Populated only when the label matched 2+ distinct fixed categories
   *  (a genuine ambiguity) — empty for a plain no-match. */
  candidates: SystemTaxCategory[];
}

export interface CaReconResult {
  matched: CaReconMatch[];
  /** The CA document has this category (classified), but this app has no
   *  rows for it for this AY. */
  missingInSystem: Array<CaReconGap & { caAmount: number }>;
  /** This app has this category (non-zero) for this AY, but no CA line item
   *  was classified to it. */
  missingInCaDoc: Array<CaReconGap & { systemAmount: number }>;
  /** CA line items that couldn't be resolved automatically — needs the user
   *  to pick a category (or "no equivalent") before they count either way. */
  unclassified: CaReconUnclassified[];
}

export interface CaReconSystemData {
  income: { head: IncomeHead; amount: number }[];
  deductions: { section: string; amount: number }[];
  payments: { type: PaymentType; amount: number }[];
  assessment: TaxAssessment | null;
}

function systemAmountForFixedCategory(category: SystemTaxCategory, system: CaReconSystemData): number | null {
  const [kind, key] = category.split(":") as [string, string];
  if (kind === "income") {
    const rows = system.income.filter((r) => r.head === (key as IncomeHead));
    return rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.amount, 0);
  }
  if (kind === "payment") {
    const rows = system.payments.filter((r) => r.type === (key as PaymentType));
    return rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.amount, 0);
  }
  const value = system.assessment?.[key as AssessmentAmountField];
  return typeof value === "number" ? value : null;
}

export function reconcileCaComputation(
  caLines: { label: string; amount: number }[],
  system: CaReconSystemData,
  learnedRules: LearnedCaLabelRule[],
): CaReconResult {
  const rules: KeywordRule<SystemTaxCategory>[] = [
    ...BUILTIN_RULES,
    ...learnedRules.map((r) => ({ keyword: r.keyword, category: r.category })),
  ];

  const matched: CaReconMatch[] = [];
  const missingInSystem: Array<CaReconGap & { caAmount: number }> = [];
  const unclassified: CaReconUnclassified[] = [];
  const matchedFixedCategories = new Set<SystemTaxCategory>();
  const matchedDeductionSections = new Set<string>();

  for (const line of caLines) {
    const fixed = matchCategory(line.label, rules);
    if (fixed.category) {
      matchedFixedCategories.add(fixed.category);
      const systemAmount = systemAmountForFixedCategory(fixed.category, system);
      if (systemAmount == null) {
        missingInSystem.push({ label: labelForSystemCategory(fixed.category), kind: kindOfCategory(fixed.category), caAmount: line.amount });
      } else {
        matched.push({ caLabel: line.label, caAmount: line.amount, systemLabel: labelForSystemCategory(fixed.category), systemAmount });
      }
      continue;
    }
    if (fixed.ambiguous) {
      unclassified.push({ caLabel: line.label, caAmount: line.amount, candidates: fixed.candidates });
      continue;
    }
    const section = system.deductions.find((d) => entitiesMatch(line.label, d.section));
    if (section) {
      matchedDeductionSections.add(section.section);
      matched.push({ caLabel: line.label, caAmount: line.amount, systemLabel: `Deduction ${section.section}`, systemAmount: section.amount });
      continue;
    }
    unclassified.push({ caLabel: line.label, caAmount: line.amount, candidates: [] });
  }

  const missingInCaDoc: Array<CaReconGap & { systemAmount: number }> = [];
  for (const category of ALL_FIXED_CATEGORIES) {
    if (matchedFixedCategories.has(category)) continue;
    const amount = systemAmountForFixedCategory(category, system);
    if (!amount) continue; // null or zero — nothing meaningful to flag as "missing"
    missingInCaDoc.push({ label: labelForSystemCategory(category), kind: kindOfCategory(category), systemAmount: amount });
  }
  for (const d of system.deductions) {
    if (matchedDeductionSections.has(d.section) || !d.amount) continue;
    missingInCaDoc.push({ label: `Deduction ${d.section}`, kind: "deduction", systemAmount: d.amount });
  }

  return { matched, missingInSystem, missingInCaDoc, unclassified };
}
