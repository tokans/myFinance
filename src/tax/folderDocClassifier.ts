/**
 * Classifies a filename found while scanning a folder of tax documents (and
 * bank/credit-card statements — the same folder often holds both)
 * (`pages/TaxFolderImport.tsx`) into one of the app's known import doc types,
 * so the file can be routed to the matching import page without the user
 * picking through each one by hand. Built on `lib/keywordCategoryMatcher.ts`'s
 * generic "seed + evolve" matcher — the builtin rules below are a starting
 * point, not exhaustive; `learnDocKeyword` grows the list from user
 * corrections, persisted the same way `statements/passwordPatternLearning.ts`
 * persists its learned shapes (via `db/settings.ts`'s generic key/value store).
 */
import { getSetting, setSetting } from "@/db/settings";
import { matchCategory, upsertLearnedRule, type CategoryMatch, type KeywordRule } from "@/lib/keywordCategoryMatcher";

export type FolderDocType =
  | "form16"
  | "form26as"
  | "ais_pdf"
  | "tis_pdf"
  | "capital_gains"
  | "it_return"
  | "itr_json"
  | "ca_computation"
  | "bank_statement";

/** Single source of truth for both the picker dropdown's label and the
 *  queue's next-route lookup (`hooks/useQueuedDocumentImport.ts`). */
export const FOLDER_DOC_TYPES: Record<FolderDocType, { label: string; route: string }> = {
  form16: { label: "Form 16", route: "/tax/form16" },
  form26as: { label: "Form 26AS", route: "/tax/26as" },
  ais_pdf: { label: "AIS (PDF)", route: "/tax/ais-pdf" },
  tis_pdf: { label: "TIS (PDF)", route: "/tax/tis-pdf" },
  capital_gains: { label: "Capital Gains Statement", route: "/tax/capital-gains" },
  it_return: { label: "IT-Return document", route: "/tax/it-return" },
  itr_json: { label: "ITR JSON", route: "/tax/import" },
  ca_computation: { label: "CA Tax Calculation", route: "/tax/ca-computation" },
  bank_statement: { label: "Bank/Credit Card Statement", route: "/import/statement-pdf" },
};

/** Starting-point filename patterns per doc type — refine/extend via
 *  `learnDocKeyword` as real filenames are seen, same posture as
 *  `statements/institutionTemplates.ts`'s seed disclaimer. `itr_json` has no
 *  keyword rule here — see `classifyFilenameSync`'s extension check. */
const BUILTIN_RULES: KeywordRule<FolderDocType>[] = [
  { keyword: "form16", category: "form16" },
  { keyword: "form 16", category: "form16" },
  { keyword: "salary tds certificate", category: "form16" },
  { keyword: "26as", category: "form26as" },
  { keyword: "form26as", category: "form26as" },
  { keyword: "annual tax statement", category: "form26as" },
  { keyword: "tax credit statement", category: "form26as" },
  { keyword: "ais", category: "ais_pdf" },
  { keyword: "annual information statement", category: "ais_pdf" },
  { keyword: "tis", category: "tis_pdf" },
  { keyword: "taxpayer information summary", category: "tis_pdf" },
  { keyword: "capital gain", category: "capital_gains" },
  { keyword: "capitalgains", category: "capital_gains" },
  { keyword: "cg statement", category: "capital_gains" },
  { keyword: "ltcg", category: "capital_gains" },
  { keyword: "stcg", category: "capital_gains" },
  { keyword: "itr v", category: "it_return" },
  { keyword: "itrv", category: "it_return" },
  { keyword: "acknowledg", category: "it_return" },
  { keyword: "intimation", category: "it_return" },
  { keyword: "143 1", category: "it_return" },
  { keyword: "ca computation", category: "ca_computation" },
  { keyword: "ca calculation", category: "ca_computation" },
  { keyword: "tax computation", category: "ca_computation" },
  { keyword: "computation sheet", category: "ca_computation" },
  { keyword: "computation of income", category: "ca_computation" },
  { keyword: "bank statement", category: "bank_statement" },
  { keyword: "account statement", category: "bank_statement" },
  { keyword: "statement of account", category: "bank_statement" },
  { keyword: "passbook", category: "bank_statement" },
  { keyword: "credit card statement", category: "bank_statement" },
  { keyword: "cc statement", category: "bank_statement" },
];

export interface LearnedDocKeywordRule {
  keyword: string;
  docType: FolderDocType;
}

const LEARNED_DOC_KEYWORDS_SETTING_KEY = "tax_folder_import_learned_doc_keywords";

export async function loadLearnedDocKeywordRules(): Promise<LearnedDocKeywordRule[]> {
  const raw = await getSetting(LEARNED_DOC_KEYWORDS_SETTING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LearnedDocKeywordRule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remembers `keyword` -> `docType` for future scans (last-write-wins on the
 *  same normalized keyword text). No-op for an empty/whitespace keyword. */
export async function learnDocKeyword(keyword: string, docType: FolderDocType): Promise<void> {
  if (!keyword.trim()) return;
  const existing = await loadLearnedDocKeywordRules();
  const next = upsertLearnedRule(
    existing.map((r) => ({ keyword: r.keyword, category: r.docType })),
    { keyword, category: docType },
  ).map((r) => ({ keyword: r.keyword, docType: r.category }));
  await setSetting(LEARNED_DOC_KEYWORDS_SETTING_KEY, JSON.stringify(next));
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Pure/synchronous core — takes already-loaded learned rules so a folder scan
 * of many files does one settings read total (`loadLearnedDocKeywordRules`),
 * not one per file. A bare `.json` extension is decisive on its own for
 * `itr_json` (checked before the keyword rules run): "itr" alone is too
 * collision-prone with `it_return` (PDF acknowledgments/intimations
 * routinely have "ITR" in the filename too), but nothing else in this app
 * imports a `.json` tax document.
 */
export function classifyFilenameSync(filename: string, learnedRules: LearnedDocKeywordRule[]): CategoryMatch<FolderDocType> {
  if (extensionOf(filename) === "json") {
    return { category: "itr_json", matchedKeyword: null, ambiguous: false, candidates: ["itr_json"] };
  }
  const rules: KeywordRule<FolderDocType>[] = [
    ...BUILTIN_RULES,
    ...learnedRules.map((r) => ({ keyword: r.keyword, category: r.docType })),
  ];
  return matchCategory(stripExtension(filename), rules);
}

/** Convenience wrapper that loads learned rules itself — fine for a single
 *  file or a test; `TaxFolderImportPage` calls `loadLearnedDocKeywordRules`
 *  once and `classifyFilenameSync` in a loop instead, to avoid N settings
 *  reads for N files. */
export async function classifyFilename(filename: string): Promise<CategoryMatch<FolderDocType>> {
  return classifyFilenameSync(filename, await loadLearnedDocKeywordRules());
}

/** File kinds `documentIntake.ts`/`openProtectedDocument` can open (pdf, zip,
 *  xlsx, xls, txt), plus `json` for the ITR-JSON path which bypasses that
 *  pipeline entirely (parsed directly via `tax/itrParser.ts`, same as
 *  `TaxImportPage` already does). */
export const FOLDER_IMPORT_ALLOWED_EXTENSIONS = new Set(["pdf", "zip", "xlsx", "xls", "txt", "json"]);

export function isSupportedFolderDocFile(filename: string): boolean {
  return FOLDER_IMPORT_ALLOWED_EXTENSIONS.has(extensionOf(filename));
}
