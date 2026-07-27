/**
 * Cross-checks AIS SFT (Statement of Financial Transaction) rows — large-value
 * transactions banks/registrars/AMCs report to the tax department — against
 * this app's own bank transaction ledger, so a user can spot a mismatch
 * between what a reporting entity told the tax department and what actually
 * shows up in their statements. Deterministic (no LLM, per house rule):
 * reporting-entity/account-institution names are matched by normalized
 * substring containment, and the expected debit/credit direction is inferred
 * from the SFT code/description via an ordered keyword rule table (same idiom
 * as `domain/transactionCategory.ts`). Purely informational — never blocks or
 * auto-corrects tax figures, since entity-name matching here is inherently
 * fuzzy (the whole point of a *cross-check*, not an authoritative merge).
 *
 * Pure, no DB/React (same convention as calc.ts).
 */

import { entitiesMatch } from "./entityMatch";

export interface SftRow {
  sftCode: string;
  description: string;
  reportingEntity: string | null;
  amount: number;
}

export interface BankTransactionForCrossCheck {
  id: number;
  accountId: number;
  /** The account's institution (e.g. "HDFC Bank"), or null. */
  institution: string | null;
  debit: number | null;
  credit: number | null;
}

export type SftCrossCheckStatus = "reconciled" | "higher_in_bank" | "lower_in_bank" | "no_data";

export interface SftCrossCheckResult {
  sftRow: SftRow;
  matchedAccountIds: number[];
  bankTotal: number;
  difference: number;
  status: SftCrossCheckStatus;
}

const CREDIT_HINTS = [/deposit/i, /credit/i, /received/i, /\bsale\s+of\b/i, /redemption/i, /interest/i, /dividend/i, /refund/i];
const DEBIT_HINTS = [/withdrawal/i, /purchase/i, /payment/i, /investment/i, /paid/i];

/** Best-effort expected direction from an SFT row's code/description, or null (both directions summed) when nothing hints either way. */
function inferDirection(row: SftRow): "debit" | "credit" | null {
  const text = `${row.sftCode} ${row.description}`;
  if (CREDIT_HINTS.some((re) => re.test(text))) return "credit";
  if (DEBIT_HINTS.some((re) => re.test(text))) return "debit";
  return null;
}

export function crossCheckSft(
  sftRows: SftRow[],
  transactions: BankTransactionForCrossCheck[],
  toleranceFraction = 0.1,
): SftCrossCheckResult[] {
  return sftRows.map((sftRow) => {
    const direction = inferDirection(sftRow);
    const matched = transactions.filter((t) => entitiesMatch(sftRow.reportingEntity, t.institution));

    const matchedAccountIds = Array.from(new Set(matched.map((t) => t.accountId)));
    let bankTotal = 0;
    for (const t of matched) {
      if (direction === "debit") bankTotal += t.debit ?? 0;
      else if (direction === "credit") bankTotal += t.credit ?? 0;
      else bankTotal += (t.debit ?? 0) + (t.credit ?? 0);
    }

    const difference = bankTotal - sftRow.amount;
    let status: SftCrossCheckStatus;
    if (matchedAccountIds.length === 0) status = "no_data";
    else if (Math.abs(difference) <= sftRow.amount * toleranceFraction) status = "reconciled";
    else if (difference > 0) status = "higher_in_bank";
    else status = "lower_in_bank";

    return { sftRow, matchedAccountIds, bankTotal, difference, status };
  });
}
