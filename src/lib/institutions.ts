/**
 * Best-guess the institution for an account from its free-text name, by matching
 * a run of consecutive letters against the known institution list (e.g. "HDFC
 * Savings" → "HDFC Bank", "SBI FD" → "State Bank of India", "AXIS MF" → "Axis
 * Bank"). Also derives the implied account type from the institution's kind
 * (bank → savings, broker → stocks, MF platform → mutual funds). Pure — no DB,
 * no React — so the add/edit form and the importer can both reuse it. Mirrors
 * the `inferAccountType` convention in `@/lib/accountTypes`.
 */

import institutions from "@/masters/data/institutions.json";
import type { MasterOption } from "@/masters/types";
import { inferAccountType, type AccountType } from "@/lib/accountTypes";

const BAKED_INSTITUTIONS = institutions as MasterOption[];

// Common abbreviations / acronyms a user might type instead of the full name.
// Matched as a token *prefix* (see hasTokenPrefix) so glued forms like "SBIFD"
// or "HDFCsavings" still resolve. Keyed lower-case → canonical institution value.
const INSTITUTION_ALIASES: Record<string, string> = {
  sbi: "State Bank of India",
  pnb: "Punjab National Bank",
  bob: "Bank of Baroda",
  hdfc: "HDFC Bank",
  icici: "ICICI Bank",
  axis: "Axis Bank",
  kotak: "Kotak Mahindra Bank",
  idfc: "IDFC First Bank",
  indusind: "IndusInd Bank",
  canara: "Canara Bank",
  hsbc: "HSBC",
  dbs: "DBS Bank",
  scb: "Standard Chartered",
};

// The account type each institution implies when the name carries no explicit
// type word of its own (e.g. a bare "Zerodha" account → stocks). Banks → a
// savings account, brokerages → stocks, MF platforms → mutual funds.
const INSTITUTION_TYPE: Record<string, AccountType> = {
  "HDFC Bank": "bank_savings",
  "ICICI Bank": "bank_savings",
  "State Bank of India": "bank_savings",
  "Axis Bank": "bank_savings",
  "Kotak Mahindra Bank": "bank_savings",
  "IndusInd Bank": "bank_savings",
  "Yes Bank": "bank_savings",
  "IDFC First Bank": "bank_savings",
  "Bank of Baroda": "bank_savings",
  "Punjab National Bank": "bank_savings",
  "Canara Bank": "bank_savings",
  "Union Bank of India": "bank_savings",
  "AU Small Finance Bank": "bank_savings",
  "Citibank": "bank_savings",
  "HSBC": "bank_savings",
  "Standard Chartered": "bank_savings",
  "DBS Bank": "bank_savings",
  "Zerodha": "stocks",
  "Groww": "stocks",
  "Upstox": "stocks",
  "Angel One": "stocks",
  "ICICI Direct": "stocks",
  "HDFC Securities": "stocks",
  "Kotak Securities": "stocks",
  "Paytm Money": "stocks",
  "Vanguard": "stocks",
  "Fidelity": "stocks",
  "Charles Schwab": "stocks",
  "Interactive Brokers": "stocks",
  "Coin by Zerodha": "mutual_funds",
};

// Generic words that appear across many institutions and so don't, on their own,
// identify which one — a bare "Bank" match must never drive a guess. The
// distinctive token (HDFC / Zerodha / Axis / Baroda…) is what we key on.
const INSTITUTION_STOPWORDS = new Set([
  "bank", "of", "the", "india", "securities", "finance", "small", "and",
  "co", "ltd", "limited", "group", "services", "first",
]);

// Shortest run of consecutive letters we'll trust as a match. Below this, a
// coincidental fragment risks false positives.
const MIN_TOKEN_LEN = 3;

/** Lower-case, collapse any non-alphanumeric run to a single space, trim. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word (boundary-delimited) presence of `word` in already-normalised `haystack`. */
function hasWholeWord(haystack: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(word)}([^a-z0-9]|$)`, "i").test(haystack);
}

/**
 * `token` present at the START of a word, even when glued to following letters —
 * so "sbi" matches "sbi", "sbi-fd" and "sbifd" (but not "xsbi"). Used for the
 * acronym aliases, where users commonly run the abbreviation into the rest.
 */
function hasTokenPrefix(haystack: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(token)}`, "i").test(haystack);
}

/**
 * Returns the matching institution's value, or null when nothing matches.
 * Scoring: the full institution name appearing as a phrase wins outright;
 * otherwise the longest distinctive word shared with the name, or a known
 * acronym alias. On a tie the earlier option in the baked list wins (banks
 * precede brokerages), so "HDFC Savings" resolves to "HDFC Bank".
 */
export function inferInstitution(
  name: string | null | undefined,
  options: MasterOption[] = BAKED_INSTITUTIONS,
): string | null {
  if (!name) return null;
  const h = norm(name);
  if (!h) return null;

  // Score every option from the list…
  let best: { value: string; score: number } | null = null;
  for (const opt of options) {
    const nv = norm(opt.value);
    if (nv.length < MIN_TOKEN_LEN) continue;

    let score = 0;
    if (hasWholeWord(h, nv)) {
      // Whole institution name present as a phrase → strongest signal.
      score = 100 + nv.length;
    } else {
      for (const word of nv.split(" ")) {
        if (word.length < MIN_TOKEN_LEN || INSTITUTION_STOPWORDS.has(word)) continue;
        if (hasWholeWord(h, word)) score = Math.max(score, word.length);
      }
    }
    if (score > 0 && (best === null || score > best.score)) {
      best = { value: opt.value, score };
    }
  }

  // …then let an acronym alias override only when the list gave us nothing,
  // so "SBI FD" / "SBIFD" resolve even though "SBI" isn't a baked label.
  if (!best) {
    for (const [alias, value] of Object.entries(INSTITUTION_ALIASES)) {
      if (hasTokenPrefix(h, alias)) return value;
    }
  }
  return best?.value ?? null;
}

/** The account type a known institution implies on its own, or null if unknown. */
export function institutionImpliedType(institution: string | null | undefined): AccountType | null {
  if (!institution) return null;
  return INSTITUTION_TYPE[institution] ?? null;
}

// Type abbreviations that may be glued onto an institution acronym (e.g.
// "AXISBMF", "SBIFD", "HDFCRD"). Ordered longest-first so "ppf"/"epf" beat the
// bare "pf". Only matched as the SUFFIX of the leftover after stripping the
// acronym (see inferGluedType), which keeps "rd" out of "standard"/"rewards".
const TYPE_ABBREV: { abbr: string; type: AccountType }[] = [
  { abbr: "ulip", type: "insurance" },
  { abbr: "ppf", type: "ppf" },
  { abbr: "epf", type: "epf" },
  { abbr: "nps", type: "nps" },
  { abbr: "etf", type: "etf" },
  { abbr: "sip", type: "mutual_funds" },
  { abbr: "mf", type: "mutual_funds" },
  { abbr: "fd", type: "fixed_deposit" },
  { abbr: "rd", type: "recurring_deposit" },
  { abbr: "cc", type: "credit_card" },
  { abbr: "pf", type: "epf" },
];

/**
 * Pull a type out of a token that glues an institution acronym to a type
 * abbreviation, e.g. "AXISBMF" → mutual_funds, "SBIFD" → fixed_deposit. Scoped
 * tightly to stay safe: for each whitespace token that STARTS with a known
 * acronym alias, the abbreviation is only accepted as the SUFFIX of what remains
 * after the acronym. So "standardchartered" (no acronym prefix) and "axisrewards"
 * ("…ds", not "rd") never produce a false hit.
 */
function inferGluedType(name: string): AccountType | null {
  for (const token of norm(name).split(" ")) {
    for (const alias of Object.keys(INSTITUTION_ALIASES)) {
      if (token.length <= alias.length || !token.startsWith(alias)) continue;
      const rest = token.slice(alias.length);
      for (const { abbr, type } of TYPE_ABBREV) {
        // Exact suffix only — NOT a plural here. "AXISREWARDS" → "rewards" ends
        // in "rds", which a plural "rd"+s would wrongly read as recurring_deposit.
        // The common plural ("Axis MFs", with a separator) is caught earlier by
        // the whole-word keyword scan instead.
        if (rest.endsWith(abbr)) return type;
      }
    }
  }
  return null;
}

/**
 * Account type for a name, in priority order: an explicit type word ("FD", "MF",
 * "Loan"); then a type glued onto an institution acronym ("AXISBMF" → MF); then
 * the type implied by a matched institution ("Zerodha" → stocks, "SBI" → bank
 * savings). Returns null when none yields a guess.
 */
export function inferAccountTypeForName(name: string | null | undefined): AccountType | null {
  if (!name) return null;
  return (
    inferAccountType(name) ??
    inferGluedType(name) ??
    institutionImpliedType(inferInstitution(name))
  );
}
