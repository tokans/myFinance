/**
 * Cross-checks/refreshes tax income from the bank transaction ledger:
 * transactions already categorized `dividend_income`/`interest_income`
 * (`domain/transactionCategory.ts`, applied at statement-import time) are
 * summed into `"LEDGER:"`-sourced tax income rows, so re-categorizing a
 * transaction later (or importing a new statement) can be reflected in the
 * tax record on demand without re-running any document import. Deterministic,
 * no LLM — same posture as `domain/sftCrossCheck.ts`.
 *
 * Share-sale proceeds are deliberately NOT computed here: capital gains tax
 * depends on holding period and FIFO cost basis, which a bank statement's net
 * credit can't provide. Matching credits are only flagged (never written),
 * pointing the user at the existing broker Capital Gains Statement import
 * instead (`tax/capitalGainsPdf.ts`).
 *
 * Pure, no DB/React (same convention as `domain/calc.ts`/`sftCrossCheck.ts`).
 */
import type { TaxIncomeRow } from "@/db/tax";

export interface LedgerTransactionForSync {
  description: string;
  credit: number | null;
  /** A transaction can carry more than one category tag (db/transactionTags.ts) —
   *  e.g. a UPI dividend payout tagged both "upi_payment" and "dividend_income". */
  categories: string[];
}

export interface LedgerTaxSyncResult {
  incomeRows: Omit<TaxIncomeRow, "id">[];
  dividendTotal: number;
  interestTotal: number;
  /** Total categorized transactions the totals above were built from. */
  transactionCount: number;
  /** Credits that look like investment/security sale proceeds — advisory
   *  only; never turned into an income row (see the module doc comment). */
  possibleShareSale: { count: number; sampleDescriptions: string[] };
}

export const LEDGER_SOURCE_PREFIX = "LEDGER:";

/**
 * "2026-27" → the FY it assesses: 2025-04-01..2026-03-31. India's tax year is
 * fixed April-March regardless of the app's own dashboard `fyStartMonth`
 * setting (a different, personal-finance-only concept — see `domain/calc.ts`).
 */
export function ayToFyRange(ay: string): { from: string; to: string } | null {
  const m = ay.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const endYear = Number(m[1]);
  return { from: `${endYear - 1}-04-01`, to: `${endYear}-03-31` };
}

/** Deterministic keyword hints for "this credit looks like a security sale",
 *  same idiom as `transactionCategory.ts`/`sftCrossCheck.ts` — no LLM. */
const SHARE_SALE_HINTS = [
  /\bredemption\b/i, /\bredeemed\b/i, /\bsold\b/i,
  /\bsale of (?:shares|units|securities|mutual fund)\b/i,
  /\bzerodha\b/i, /\bgroww\b/i, /\bupstox\b/i, /\bicici direct\b/i,
  /\bhdfc securities\b/i, /\bkotak securities\b/i, /\bangel one\b/i,
  /\b5paisa\b/i, /\bmotilal oswal\b/i,
];

function sumCredits(transactions: LedgerTransactionForSync[], category: string): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const t of transactions) {
    if (!t.categories.includes(category) || t.credit == null || t.credit <= 0) continue;
    total += t.credit;
    count++;
  }
  return { total, count };
}

export function buildLedgerTaxSync(transactions: LedgerTransactionForSync[], ay: string): LedgerTaxSyncResult {
  const dividend = sumCredits(transactions, "dividend_income");
  const interest = sumCredits(transactions, "interest_income");

  const incomeRows: Omit<TaxIncomeRow, "id">[] = [];
  if (dividend.total > 0) {
    incomeRows.push({
      ay,
      head: "dividend",
      label: "Dividend income (from bank transactions)",
      amount: dividend.total,
      source_path: `${LEDGER_SOURCE_PREFIX}dividend_income`,
      note: `From ${dividend.count} bank transaction(s) categorized as dividend income — review before relying on this; re-run "Refresh from transactions" any time you re-categorize a transaction.`,
      excluded: false,
    });
  }
  if (interest.total > 0) {
    incomeRows.push({
      ay,
      head: "other_sources",
      label: "Interest income (from bank transactions)",
      amount: interest.total,
      source_path: `${LEDGER_SOURCE_PREFIX}interest_income`,
      note: `From ${interest.count} bank transaction(s) categorized as interest income — review before relying on this; re-run "Refresh from transactions" any time you re-categorize a transaction.`,
      excluded: false,
    });
  }

  // Never a dividend_income row itself — that's already handled above.
  const shareSaleCandidates = transactions.filter(
    (t) => !t.categories.includes("dividend_income") && t.credit != null && t.credit > 0 &&
      SHARE_SALE_HINTS.some((re) => re.test(t.description)),
  );

  return {
    incomeRows,
    dividendTotal: dividend.total,
    interestTotal: interest.total,
    transactionCount: dividend.count + interest.count,
    possibleShareSale: {
      count: shareSaleCandidates.length,
      sampleDescriptions: shareSaleCandidates.slice(0, 3).map((t) => t.description),
    },
  };
}
