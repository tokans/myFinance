/**
 * Deterministic transaction-category suggestion from a bank narration string.
 * Ordered keyword/regex rules, first match wins — no LLM (hard house rule;
 * same keyword-matching idiom as sharedcorelib/ice's `mentionsContact`). Pure,
 * no DB/React (same convention as calc.ts). Runs at import time
 * (db/transactions.ts's `replaceTransactionsForSource`); a description that
 * matches nothing stays uncategorized rather than guessed.
 *
 * Rule order matters: merchant/keyword-specific rules come first so a
 * recognizable narration (e.g. "UPI-SWIGGY-...") lands on the specific
 * category before the generic payment-rail rules (NEFT/IMPS/RTGS/UPI) at the
 * bottom catch whatever's left as a plain transfer.
 */

export interface CategorySuggestion {
  category: string;
  confidence: number;
  /** Where this suggestion came from — lets the UI point at the exact rule
   *  responsible for a tag so a wrong auto-classification can be traced back
   *  and fixed (edit/forget the rule, or just remove the tag). */
  source: "learned" | "static";
  /** Present when source === "learned": the exact normalized pattern (see
   *  `normalize`) that matched — the same key shown in the "Learned rules"
   *  panel, so a wrong tag can be traced to the rule that taught it. */
  learnedPattern?: string;
  /** Present when source === "static": the regex source text of the specific
   *  built-in pattern that matched — a human-readable hint at which keyword
   *  rule fired (built-in rules aren't user-editable, only removable per-tag). */
  matchedKeyword?: string;
}

/** Sentinel "category" the wizard/bulk-classify UI appends to the transaction_category
 *  picker as a "Delete transaction" pseudo-option, alongside "Other…" — picking it
 *  deletes the selected row(s) (`db/transactions.ts`'s `deleteTransactionsByIds`)
 *  instead of writing a category. Never persisted as an actual category value. */
export const DELETE_TRANSACTION_CATEGORY = "__delete_transaction__";

/** The pseudo-option itself, shared by every `FiniteSetInput extraOptions` call
 *  site (CategoryWizard, Transactions bulk-classify) so the label/icon stay in sync. */
export const DELETE_TRANSACTION_OPTION = { value: DELETE_TRANSACTION_CATEGORY, label: "Delete transaction", icon: "🗑️" };

export interface CategoryContext {
  /** True/false when this row's direction is known (its `credit`/`debit` field). Some
   *  broader income-leaning patterns (a bare "INT", a "Ltd"/"Limited" company suffix) are
   *  skipped for a row explicitly known to be a debit, so paying a "... Ltd" vendor or an
   *  unrelated "INT" abbreviation elsewhere isn't mistaken for interest/dividend income.
   *  Omit when direction isn't known — the rule still applies in that case. */
  isCredit?: boolean;
  /** The account holder's own name (e.g. from the tax filer profile), used to recognize
   *  self-transfers — a narration naming the holder rather than a third party (e.g. "NEFT
   *  TO SAMPLE PERSON" between the user's own accounts). Matched by whitespace-separated
   *  name part (each part of length >= 3), not the string as a whole, since narrations
   *  commonly drop the middle name or reorder first/last. Omit when unknown. */
  selfName?: string;
}

interface CategoryRule {
  category: string;
  patterns: RegExp[];
  /** Skipped when the row is known to be a debit — see CategoryContext. */
  creditLeaning?: boolean;
  /** Patterns computed per-call from context instead of fixed at rule-definition time —
   *  used by transfer_self, whose match text (the account holder's name) isn't known
   *  until the caller supplies it. Combined with `patterns` when present. */
  dynamicPatterns?: (context: CategoryContext) => RegExp[];
  /** "rail" rules (the generic payment-rail keywords: upi_payment, transfer_other) are
   *  deliberately exempt from first-match-wins — they always layer on top of whatever
   *  specific category matched, e.g. a UPI grocery payment keeps both "groceries" and
   *  "upi_payment". Every other rule is "specific" (the default, omit the field): the
   *  FIRST specific rule that matches wins and every specific rule after it in RULES
   *  order is skipped, so an accidental keyword overlap between two unrelated specific
   *  categories (e.g. a broad "Ltd" match) can't also tag a second, wrong category. */
  tier?: "specific" | "rail";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One whole-word, case-insensitive pattern per name part >= 3 chars — short parts
 *  (initials, "Md") are skipped as too prone to false-positive on ordinary words. */
function selfNamePatterns(selfName: string): RegExp[] {
  return selfName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .map((part) => new RegExp(`\\b${escapeRegExp(part)}\\b`, "i"));
}

const RULES: CategoryRule[] = [
  { category: "salary_income", patterns: [/\bsalary\b/i, /\bpayroll\b/i] },
  // Kept distinct from salary_income: an employer reimbursement (travel/medical/etc.)
  // isn't taxable salary, so it must not get folded into taxable income.
  { category: "reimbursement_income", patterns: [/\breimburse(?:ment)?\b/i] },
  { category: "rent_emi", patterns: [/\bemi\b/i, /\bloan\s*(inst|repay)/i, /\brent\b/i] },
  { category: "cash_withdrawal", patterns: [/\batm\b/i, /\bc(?:a)?sh\s*wdl\b/i, /\bcash\s*withdrawal\b/i] },
  { category: "groceries", patterns: [/\bbigbasket\b/i, /\bzepto\b/i, /\bblinkit\b/i, /\bd-?mart\b/i, /\bgrocer(?:y|ies)\b/i] },
  { category: "dining_food_delivery", patterns: [/\bswiggy\b/i, /\bzomato\b/i, /\brestaurant\b/i] },
  { category: "utilities", patterns: [/\belectricity\b/i, /\bbroadband\b/i, /\bpostpaid\b/i, /\bwater\s*bill\b/i, /\bgas\s*bill\b/i] },
  { category: "shopping_retail", patterns: [/\bamazon\b/i, /\bflipkart\b/i, /\bmyntra\b/i] },
  { category: "healthcare_medical", patterns: [/\bhospital\b/i, /\bpharmacy\b/i, /\bapollo\b/i, /\bclinic\b/i] },
  { category: "insurance_premium", patterns: [/\bpremium\b/i, /\binsurance\b/i, /\blic\b/i] },
  { category: "investment_contribution", patterns: [/\bsip\b/i, /\bmutual\s*fund\b/i, /\bzerodha\b/i, /\bgroww\b/i, /\bnps\b/i] },
  // One-time big-ticket purchases (a car, gold, property), not a recurring expense.
  // Checked before tax_payment: an RTO road-tax narration often also says "challan"
  // (e.g. "RTO CHALLAN PAYMENT"), which would otherwise match the income-tax rule below.
  {
    category: "asset_purchase",
    patterns: [
      /\brto\b/i, /\broad\s*tax\b/i, /\bvehicle\s*registration\b/i, /\bshowroom\b/i,
      /\bcar\s*(?:purchase|booking|showroom)\b/i,
      /\bgold\b/i, /\bjewell?ery\b/i, /\bfurniture\b/i,
      /\bproperty\s*(?:purchase|registration)\b/i, /\bdown\s*payment\b/i,
    ],
  },
  { category: "tax_payment", patterns: [/\bincome\s*tax\b/i, /\badvance\s*tax\b/i, /\bchallan\b/i, /\bgst\b/i] },
  { category: "fees_charges", patterns: [/\b(?:annual|late|penal|service)\s*(?:fee|charge)/i] },
  { category: "entertainment_subscriptions", patterns: [/\bnetflix\b/i, /\bspotify\b/i, /\bhotstar\b/i, /\bprime\s*video\b/i] },
  { category: "travel_transport", patterns: [/\buber\b/i, /\bola\b/i, /\birctc\b/i, /\bindigo\b/i, /\bmakemytrip\b/i, /\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bpetroleum\b/i, /\bhpcl\b/i, /\bbpcl\b/i, /\biocl\b/i] },
  { category: "education", patterns: [/\btuition\b/i, /\bschool\s*fee\b/i, /\bcollege\b/i] },
  {
    category: "interest_income",
    patterns: [/\bint\.?\s*(?:cr|credit)\b/i, /\binterest\s*credit\b/i, /\bint\b/i],
    creditLeaning: true,
  },
  {
    category: "dividend_income",
    // "Div"/company-name (Ltd./Limited) narrations, e.g. "DIV TCS LTD" or a bare
    // "RELIANCE INDUSTRIES LIMITED" credit, are dividend payouts more often than not.
    patterns: [/\bdividend\b/i, /\bdiv\b/i, /\b(?:ltd\.?|limited)\b/i],
    creditLeaning: true,
  },
  {
    category: "transfer_family",
    patterns: [
      /\bwife\b/i, /\bhusband\b/i, /\bspouse\b/i,
      /\bson\b/i, /\bdaughter\b/i,
      /\bmother\b/i, /\bfather\b/i, /\bmom\b/i, /\bdad\b/i, /\bmummy\b/i, /\bpapa\b/i,
      /\bbrother\b/i, /\bsister\b/i, /\bparents?\b/i,
    ],
  },
  // Dynamic-only rule: matches whenever the narration names the account holder
  // (see CategoryContext.selfName) — no static patterns of its own.
  { category: "transfer_self", patterns: [], dynamicPatterns: (ctx) => (ctx.selfName ? selfNamePatterns(ctx.selfName) : []) },
  // Generic payment-rail keywords, deliberately last: a plain person-to-person
  // transfer that matched nothing more specific above. UPI gets its own category
  // (distinct from NEFT/IMPS/RTGS) since it's the dominant everyday rail.
  { category: "upi_payment", patterns: [/\bupi\b/i], tier: "rail" },
  { category: "transfer_other", patterns: [/\bneft\b/i, /\bimps\b/i, /\brtgs\b/i], tier: "rail" },
];

/** Best-effort category guess from a raw bank narration, or null if nothing matched.
 *  First-match-wins (kept for backward compatibility) — see suggestCategoryTags for
 *  the multi-tag engine that collects every matching rule instead of just the first. */
export function suggestCategory(description: string, context: CategoryContext = {}): CategorySuggestion | null {
  const s = description.trim();
  if (!s) return null;
  const isDebit = context.isCredit === false;
  for (const rule of RULES) {
    if (rule.creditLeaning && isDebit) continue;
    const patterns = rule.dynamicPatterns ? [...rule.patterns, ...rule.dynamicPatterns(context)] : rule.patterns;
    if (patterns.some((re) => re.test(s))) return { category: rule.category, confidence: 0.8, source: "static" };
  }
  return null;
}

export interface SuggestTagsOptions {
  /** Rule categories to skip entirely — e.g. excluding "upi_payment" so a narration
   *  that only ever matched the generic rail rule is forced to either surface a more
   *  specific category or come back empty, for the "other possible categories" review. */
  exclude?: string[];
}

const RAIL_CATEGORIES = new Set(RULES.filter((r) => r.tier === "rail").map((r) => r.category));

/** Core static-rule pass shared by suggestCategoryTags and suggestCategoryTagsWithRules.
 *  `seen` is pre-populated with categories already produced by a learned-rule match (so a
 *  static rule for the same category isn't re-tested/re-added), and `specificAlreadyMatched`
 *  lets a learned SPECIFIC category count as "the" first match — a static specific rule
 *  never fires after it, but the rail rules (upi_payment/transfer_other) always still do. */
function matchStaticRules(
  s: string,
  context: CategoryContext,
  excluded: Set<string>,
  seen: Set<string>,
  specificAlreadyMatched: boolean,
): CategorySuggestion[] {
  const isDebit = context.isCredit === false;
  const out: CategorySuggestion[] = [];
  let specificMatched = specificAlreadyMatched;
  for (const rule of RULES) {
    if (excluded.has(rule.category) || seen.has(rule.category)) continue;
    if (rule.creditLeaning && isDebit) continue;
    const isRail = rule.tier === "rail";
    if (!isRail && specificMatched) continue;
    const patterns = rule.dynamicPatterns ? [...rule.patterns, ...rule.dynamicPatterns(context)] : rule.patterns;
    const matched = patterns.find((re) => re.test(s));
    if (!matched) continue;
    out.push({ category: rule.category, confidence: 0.8, source: "static", matchedKeyword: matched.source });
    if (!isRail) specificMatched = true;
  }
  return out;
}

/**
 * Like suggestCategory, but collects every matching rule instead of stopping at the
 * very first one in RULES — a transaction can carry more than one tag (e.g. a UPI
 * grocery payment matches both the specific "groceries" rule and the generic
 * "upi_payment" rail rule, and the tags model wants both). Rule ordering still
 * matters within the "specific" tier though: the first specific rule that matches
 * wins and every specific rule after it is skipped (so an accidental keyword overlap
 * between two unrelated specific categories can't also tag a second, wrong category)
 * — only the rail tier (upi_payment/transfer_other) is exempt and always layers on.
 */
export function suggestCategoryTags(
  description: string,
  context: CategoryContext = {},
  opts: SuggestTagsOptions = {},
): CategorySuggestion[] {
  const s = description.trim();
  if (!s) return [];
  const excluded = new Set(opts.exclude ?? []);
  return matchStaticRules(s, context, excluded, new Set(), false);
}

/**
 * suggestCategoryTags, but checking the user's own learned rules FIRST — a
 * pattern→categories map built from every past manual tag (db/categoryRules.ts's
 * getCategoryRuleMap()), kept independently of the transaction rows that taught it.
 * A learned match is treated as higher-confidence than the static keyword heuristic:
 * it's reproducing this exact user's own past decision for this exact narration
 * shape. Falls back to (and is unioned with) suggestCategoryTags's heuristic matches.
 *
 * A learned SPECIFIC category counts as the "first match" for the specific-tier
 * ordering too: once one is found, no static specific rule fires afterward — only
 * a static rail rule (upi_payment/transfer_other) still layers on independently.
 */
export function suggestCategoryTagsWithRules(
  description: string,
  learnedRules: ReadonlyMap<string, string[]>,
  context: CategoryContext = {},
  opts: SuggestTagsOptions = {},
): CategorySuggestion[] {
  const s = description.trim();
  if (!s) return [];
  const key = normalize(description);
  const excluded = new Set(opts.exclude ?? []);
  const seen = new Set<string>();
  const out: CategorySuggestion[] = [];
  let specificMatched = false;
  for (const category of learnedRules.get(key) ?? []) {
    if (excluded.has(category) || seen.has(category)) continue;
    seen.add(category);
    out.push({ category, confidence: 0.95, source: "learned", learnedPattern: key });
    if (!RAIL_CATEGORIES.has(category)) specificMatched = true;
  }
  out.push(...matchStaticRules(s, context, excluded, seen, specificMatched));
  return out;
}

/** Digits collapse to '#' so narrations differing only by a reference number/date
 *  (e.g. two UPI charges to the same merchant) are still recognized as "the same".
 *  Exported for db/categoryRules.ts, which uses it as the learned-rule pattern key. */
export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");
}

/** Ids of every row in `candidates` whose description normalizes the same as
 *  `seed` — powers "apply to the N other transactions that look like this too". */
export function similarByDescription(seed: string, candidates: Array<{ id: number; description: string }>): number[] {
  const key = normalize(seed);
  if (!key) return [];
  return candidates.filter((c) => normalize(c.description) === key).map((c) => c.id);
}
