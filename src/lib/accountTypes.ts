/**
 * Canonical account-type vocabulary — single source of truth for the value
 * keys, their display labels, and the layout of the icon sprite used by the
 * add/edit picker. Pure data, no React, no DB, so it can be imported by the
 * data layer (`db/accounts.ts`), pages, and components alike.
 *
 * Order matters: it defines both the picker grid order and the sprite cell
 * index (row-major, `SPRITE_COLS` per row). Keep it in sync with the image
 * generated from `public/account-types.png` (see that asset's prompt) and with
 * the CHECK constraint in `migrations/0004_account_types.sql`.
 */

export type AccountType =
  | "bank_savings"
  | "checking"
  | "cash"
  | "fixed_deposit"
  | "recurring_deposit"
  | "ppf"
  | "epf"
  | "nps"
  | "stocks"
  | "mutual_funds"
  | "etf"
  | "bonds"
  | "pms_aif"
  | "gold"
  | "real_estate"
  | "crypto"
  | "loan"
  | "credit_card"
  | "insurance"
  | "tax_refund"
  | "other";

export interface AccountTypeMeta {
  value: AccountType;
  label: string;
  /** Short hint shown in the picker / tooltip. */
  hint?: string;
  /** Liabilities subtract from net worth; assets add. Display-only for now. */
  kind: "asset" | "liability";
}

/**
 * Row-major order; also the sprite cell order. Do not reorder without
 * regenerating `public/account-types.png` from the same sequence.
 */
export const ACCOUNT_TYPES: AccountTypeMeta[] = [
  { value: "bank_savings", label: "Bank Savings", kind: "asset", hint: "Everyday savings account" },
  { value: "checking", label: "Checking Account", kind: "asset", hint: "Current / transactional account" },
  { value: "cash", label: "Cash / Wallet", kind: "asset", hint: "Physical cash or e-wallet" },
  { value: "fixed_deposit", label: "Fixed Deposit", kind: "asset", hint: "Locked-term deposit (FD)" },
  { value: "recurring_deposit", label: "Recurring Deposit", kind: "asset", hint: "Monthly-contribution deposit (RD)" },
  { value: "ppf", label: "PPF", kind: "asset", hint: "Public Provident Fund" },
  { value: "epf", label: "EPF / Provident Fund", kind: "asset", hint: "Employee/Provident fund" },
  { value: "nps", label: "NPS", kind: "asset", hint: "National Pension System" },
  { value: "stocks", label: "Stocks", kind: "asset", hint: "Direct equity holdings" },
  { value: "mutual_funds", label: "Mutual Funds", kind: "asset", hint: "MF / SIP holdings" },
  { value: "etf", label: "ETF", kind: "asset", hint: "Exchange-traded funds" },
  { value: "bonds", label: "Bonds", kind: "asset", hint: "Govt / corporate bonds" },
  { value: "pms_aif", label: "PMS / AIF", kind: "asset", hint: "Portfolio Management / Alternative Investment Funds" },
  { value: "gold", label: "Gold / Precious Metals", kind: "asset", hint: "Physical or digital gold, SGBs" },
  { value: "real_estate", label: "Real Estate", kind: "asset", hint: "Property holdings" },
  { value: "crypto", label: "Crypto", kind: "asset", hint: "Digital assets" },
  { value: "loan", label: "Loan", kind: "liability", hint: "Outstanding loan balance" },
  { value: "credit_card", label: "Credit Card", kind: "liability", hint: "Card outstanding" },
  { value: "insurance", label: "Insurance", kind: "asset", hint: "Cash-value / ULIP / endowment" },
  { value: "other", label: "Others", kind: "asset", hint: "Anything else — describe it" },
  // Appended last on purpose: the icon sprite (account-types.png) bakes one cell
  // per type in this order, so a new type must go at the end to keep every
  // existing cell aligned — it falls back to an inline lucide icon (see
  // SPRITE_CELL_COUNT). Sign-bearing: a positive balance is a refund due to you
  // (an asset); a negative balance is tax still payable, which reduces net worth.
  // Kept "asset" so the value is summed with its sign rather than abs-ed.
  { value: "tax_refund", label: "Tax Refund", kind: "asset", hint: "Refund due (positive) / tax payable (negative)" },
];

export const ACCOUNT_TYPE_VALUES = ACCOUNT_TYPES.map((t) => t.value) as [
  AccountType,
  ...AccountType[],
];

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.value, t.label]),
);

/** Display label for a stored type; falls back to the raw value defensively. */
export function accountTypeLabel(type: string): string {
  return LABEL_BY_VALUE[type] ?? type;
}

const KIND_BY_VALUE: Record<string, "asset" | "liability"> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.value, t.kind]),
);

/** Whether a stored type counts as an asset or a liability; unknown → asset. */
export function accountTypeKind(type: string): "asset" | "liability" {
  return KIND_BY_VALUE[type] ?? "asset";
}

/** Type keys that reduce net worth (subtracted in net-worth aggregates). */
export const LIABILITY_TYPES: AccountType[] = ACCOUNT_TYPES.filter(
  (t) => t.kind === "liability",
).map((t) => t.value);

/**
 * Locked retirement vehicles (NPS/EPF/PPF). Their corpus is generally
 * inaccessible until ~60, so the FIRE planner models them as a guaranteed
 * retirement *income* stream (a withdrawal/annuity on the balance) rather than
 * as early-retirement drawdown capital — see the FIRE calculator's prefill.
 */
export const RETIREMENT_INCOME_TYPES: AccountType[] = ["nps", "epf", "ppf"];

// Keyword → type, scanned in order so the most specific match wins (e.g. "PPF
// Savings" → ppf before bank_savings; "Home Loan" → loan). Matching is
// whole-word and case-insensitive. Generic single words like "bank" are left
// out on purpose — too ambiguous to guess from.
const TYPE_KEYWORDS: { type: AccountType; words: string[] }[] = [
  { type: "credit_card", words: ["credit card", "creditcard", "cc"] },
  { type: "fixed_deposit", words: ["fixed deposit", "term deposit", "fd"] },
  { type: "recurring_deposit", words: ["recurring deposit", "rd"] },
  { type: "ppf", words: ["ppf", "public provident"] },
  { type: "epf", words: ["epf", "employee provident", "provident fund", "pf"] },
  { type: "nps", words: ["nps", "national pension", "pension"] },
  { type: "mutual_funds", words: ["mutual fund", "mutual funds", "mf", "sip"] },
  { type: "etf", words: ["etf"] },
  { type: "stocks", words: ["stock", "stocks", "equity", "equities", "shares", "demat"] },
  { type: "bonds", words: ["bond", "bonds", "debenture", "debentures"] },
  { type: "pms_aif", words: ["pms", "aif", "portfolio management", "alternative investment"] },
  { type: "gold", words: ["gold", "silver", "sgb", "sovereign gold", "precious metal"] },
  { type: "real_estate", words: ["real estate", "realty", "property", "apartment", "flat", "plot", "land"] },
  { type: "crypto", words: ["crypto", "bitcoin", "ethereum", "btc", "eth"] },
  { type: "insurance", words: ["insurance", "ulip", "endowment", "lic", "term plan", "policy"] },
  { type: "loan", words: ["loan", "mortgage", "emi"] },
  // Lower priority than the specific investment/deposit types above, so a
  // "Tax Saver FD"/"ELSS Tax Saver" still resolves to fd/mutual_funds; a bare
  // "Tax" / "Income Tax Refund" / "Advance Tax" lands here.
  { type: "tax_refund", words: ["tax refund", "income tax", "advance tax", "self assessment tax", "tax"] },
  { type: "checking", words: ["checking", "current account", "current a/c", "current"] },
  { type: "bank_savings", words: ["savings", "saving"] },
  { type: "cash", words: ["cash", "wallet"] },
];

function hasWholeWord(haystack: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  // Trailing `s?` tolerates a plural ("MFs", "FDs", "ETFs", "loans") — the
  // required boundary BEFORE the word still blocks mid-word hits ("rd" in
  // "standard"), so allowing a plural suffix doesn't widen those.
  return new RegExp(`(^|[^a-z0-9])${esc}s?([^a-z0-9]|$)`, "i").test(haystack);
}

/**
 * Best-guess account type from a free-text name (e.g. "HDFC Home Loan" → loan,
 * "SBI PPF" → ppf). Returns null when nothing matches, so callers can fall back
 * to their own default. Whole-word matching; first/most-specific rule wins.
 */
export function inferAccountType(name: string | null | undefined): AccountType | null {
  if (!name) return null;
  const h = name.toLowerCase();
  for (const { type, words } of TYPE_KEYWORDS) {
    if (words.some((w) => hasWholeWord(h, w))) return type;
  }
  return null;
}

/** The default selection for a new account. */
export const DEFAULT_ACCOUNT_TYPE: AccountType = "bank_savings";

// --- Icon sprite ----------------------------------------------------------
// A single generated image (see form-manifests/assets/account-types.prompt.txt)
// holding one 256×256 square icon per type, in `ACCOUNT_TYPES` order, laid out
// row-major with no gutters — same house pattern as public/img/life-goals.png.
// The picker slices it with background-position; when the asset is absent it
// falls back to inline lucide icons, so this is purely a visual enhancement.
export const SPRITE_URL = "/img/account-types.png";
export const SPRITE_COLS = 4;
// Number of icons actually baked into the PNG. The grid is pinned to this count
// (NOT ACCOUNT_TYPES.length) so appending a new type never rescales/​misaligns
// the existing cells — types at index >= SPRITE_CELL_COUNT fall back to an inline
// lucide icon in the picker. Bump this only when the PNG is regenerated.
export const SPRITE_CELL_COUNT = 20;
export const SPRITE_ROWS = Math.ceil(SPRITE_CELL_COUNT / SPRITE_COLS);

/** Background-position (in %) for the sprite cell at array `index`. */
export function spriteCellPosition(index: number): { x: number; y: number } {
  const col = index % SPRITE_COLS;
  const row = Math.floor(index / SPRITE_COLS);
  // Percentage positioning across an N-cell axis is col/(N-1) * 100.
  return {
    x: SPRITE_COLS > 1 ? (col / (SPRITE_COLS - 1)) * 100 : 0,
    y: SPRITE_ROWS > 1 ? (row / (SPRITE_ROWS - 1)) * 100 : 0,
  };
}
