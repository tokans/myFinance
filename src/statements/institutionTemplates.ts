/**
 * Per-institution column-label overrides for bank statement parsing, layered
 * ON TOP of the generic keyword heuristic (`columnDetect.ts`) — never instead
 * of it. A template's own regex is tried first for a given column kind; any
 * kind it doesn't cover (or an institution with no template at all) falls
 * through unchanged to the generic classifier, so this can never make a
 * result worse than before the mechanism existed. Hardcoded TS, not
 * OTA/master-data — this is parsing logic, not reference data, same
 * convention `lib/institutions.ts`'s alias/type tables already use.
 *
 * Institution values match the canonical "institution" master
 * (`masters/data/institutions.json`) so a template is keyed on the exact
 * value an `Account.institution` or a picked `FiniteSetInput` value holds.
 *
 * These four seeds are best-effort, based on commonly known Indian bank
 * e-statement column labels — NOT verified against a real captured statement
 * for each bank. That's an accepted tradeoff: an unmatched or slightly-off
 * label here just falls through to the generic classifier (which already
 * covers "withdrawal"/"deposit"/"debit"/"credit"/"balance"/"narration"/
 * "particulars"/"remarks" — see `excel/parse.ts`'s word lists), and the
 * existing raw-table + manual-review step is the real safety net. Refine
 * these once a real statement is seen to mis-parse.
 */
import type { StatementColumnKind } from "./types";

export interface StatementColumnTemplate {
  /** Canonical institution value (matches the "institution" master). */
  institution: string;
  /** Regex overrides per column kind, tried before the generic classifier. */
  columnWords: Partial<Record<StatementColumnKind, RegExp>>;
}

export const STATEMENT_TEMPLATES: StatementColumnTemplate[] = [
  {
    institution: "HDFC Bank",
    columnWords: {
      description: /\bnarration\b/i,
      debit: /\bwithdrawal amt\.?\b/i,
      credit: /\bdeposit amt\.?\b/i,
      balance: /\bclosing balance\b/i,
    },
  },
  {
    institution: "ICICI Bank",
    columnWords: {
      description: /\btransaction remarks\b/i,
      debit: /\bwithdrawal amount\b/i,
      credit: /\bdeposit amount\b/i,
      balance: /\bbalance\s*\(inr\)/i,
    },
  },
  {
    institution: "State Bank of India",
    columnWords: {
      description: /\bdescription\b/i,
      debit: /\bdebit\b/i,
      credit: /\bcredit\b/i,
      balance: /\bbalance\b/i,
    },
  },
  {
    institution: "Axis Bank",
    columnWords: {
      description: /\bparticulars\b/i,
      debit: /\bdebit\b/i,
      credit: /\bcredit\b/i,
      balance: /\bbalance\b/i,
    },
  },
];

/** The template registered for an institution, or null if none exists. */
export function templateFor(institution?: string | null): StatementColumnTemplate | null {
  if (!institution) return null;
  return STATEMENT_TEMPLATES.find((t) => t.institution === institution) ?? null;
}
