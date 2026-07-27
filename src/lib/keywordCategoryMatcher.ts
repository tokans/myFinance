/**
 * Generic "free text -> one of a known set of categories" matcher, built on a
 * partial-keyword rule list that starts from a hand-curated seed and grows as
 * callers confirm corrections (the actual persistence/seed lists live in each
 * caller — this module is pure). Same "seed + evolve" shape as
 * `statements/passwordPatternLearning.ts` (builtin list + settings-backed
 * learned list, unioned at match time), generalized so it isn't tied to
 * passwords specifically. Two callers specialize this: `tax/folderDocClassifier.ts`
 * (filename -> import doc type) and `tax/caReconciliation.ts` (CA line-item
 * label -> system tax category).
 */

export interface KeywordRule<T extends string> {
  keyword: string;
  category: T;
}

export interface CategoryMatch<T extends string> {
  /** Non-null only when exactly one distinct category was matched. */
  category: T | null;
  /** The longest matching keyword text, ties broken toward the last rule checked. */
  matchedKeyword: string | null;
  /** True when 2+ distinct categories matched — never silently resolved. */
  ambiguous: boolean;
  /** Every distinct category matched, in rule order. Empty when nothing matched. */
  candidates: T[];
}

/** Lowercase, collapse every run of non-alphanumeric characters to a single
 *  space, trim. Shared footing for both a rule's keyword and the text being
 *  classified, so `"Form 16"` and `"form16"` compare equal. */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whether `normalizedKeyword` occurs in `normalizedText` — a whole-token
 *  match for short (<=3 char) keywords (avoids "ais" matching inside "raise"),
 *  a substring match for longer ones (the "partial match" callers want, e.g.
 *  "form16" inside "Form16_PartA_2026"). */
function keywordOccurs(normalizedText: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) return false;
  if (normalizedKeyword.length <= 3) {
    return normalizedText.split(" ").includes(normalizedKeyword);
  }
  return normalizedText.includes(normalizedKeyword);
}

/**
 * Matches `text` against every rule, collecting the distinct categories any
 * rule matched. Zero -> no match. Exactly one -> confident (`category` set,
 * `matchedKeyword` is the longest matching keyword text). Two or more ->
 * `ambiguous: true`, `category: null`, every distinct category listed in
 * `candidates` — a caller must never guess between them.
 */
export function matchCategory<T extends string>(text: string, rules: KeywordRule<T>[]): CategoryMatch<T> {
  const normalizedText = normalizeText(text);
  const candidates: T[] = [];
  let matchedKeyword: string | null = null;

  for (const rule of rules) {
    const normalizedKeyword = normalizeText(rule.keyword);
    if (!keywordOccurs(normalizedText, normalizedKeyword)) continue;
    if (!candidates.includes(rule.category)) candidates.push(rule.category);
    if (!matchedKeyword || rule.keyword.length > matchedKeyword.length) matchedKeyword = rule.keyword;
  }

  if (candidates.length === 0) return { category: null, matchedKeyword: null, ambiguous: false, candidates: [] };
  if (candidates.length === 1) return { category: candidates[0], matchedKeyword, ambiguous: false, candidates };
  return { category: null, matchedKeyword: null, ambiguous: true, candidates };
}

/** The longest non-numeric token (>=3 chars) in `normalizeText(text)`, or ""
 *  if none — a starting-point suggestion for "remember this as a keyword?"
 *  UI, always user-editable before it's saved. */
export function suggestKeyword(text: string): string {
  const tokens = normalizeText(text)
    .split(" ")
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  if (tokens.length === 0) return "";
  return tokens.reduce((longest, t) => (t.length > longest.length ? t : longest), tokens[0]);
}

/** Last-write-wins insert into a learned-rule list: any prior rule for the
 *  same normalized keyword text is replaced (a fresh confirmation should win
 *  over a stale one), then the new rule is appended. Callers persist the
 *  returned array as-is. */
export function upsertLearnedRule<T extends string>(rules: KeywordRule<T>[], newRule: KeywordRule<T>): KeywordRule<T>[] {
  const key = normalizeText(newRule.keyword);
  if (!key) return rules;
  const withoutPrior = rules.filter((r) => normalizeText(r.keyword) !== key);
  return [...withoutPrior, { keyword: newRule.keyword, category: newRule.category }];
}
