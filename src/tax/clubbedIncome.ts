/**
 * Section 64(1A) clubbing: a minor child's income (other than income from the
 * minor's own manual work or special talent) is added to the parent's own
 * total income, minus the Section 10(32) exemption of up to ₹1,500 per child.
 * Only accounts explicitly marked `family_relation === "minor"` (AccountForm)
 * are eligible — an adult family member's accounts never feed the primary
 * filer's return (they're tracked on the Dashboard for net worth only).
 *
 * Persisted as a single `myfinance_tax_income` row per minor per AY, already
 * net of the exemption (head "other_sources", so it flows straight into
 * itrBuilder's grossTotalIncome like any other income line). The pre-exemption
 * amount the user actually typed is round-tripped through `note` so the return
 * builder can show it back in the edit field without a second DB row or a
 * schema change.
 */
import type { Account } from "@/db/accounts";
import type { TaxIncomeRow } from "@/db/tax";

export const CLUBBED_SOURCE_PREFIX = "CLUB:";
export const CLUBBED_EXEMPTION_PER_CHILD = 1500;

export interface ClubbedSplit {
  /** The minor's actual income for the AY, as entered (negative clamped to 0). */
  fullAmount: number;
  /** Portion covered by the Sec 10(32) exemption (≤ ₹1,500), informational only. */
  exemptPortion: number;
  /** Portion added to the primary filer's taxable income (Sec 64(1A)). */
  taxablePortion: number;
}

export function splitClubbedIncome(rawAmount: number): ClubbedSplit {
  const fullAmount = Number.isFinite(rawAmount) ? Math.max(0, rawAmount) : 0;
  const exemptPortion = Math.min(CLUBBED_EXEMPTION_PER_CHILD, fullAmount);
  return { fullAmount, exemptPortion, taxablePortion: fullAmount - exemptPortion };
}

/** Build the single tax_income row persisted for one minor's clubbed income for an AY. */
export function clubbedIncomeRow(
  ay: string,
  account: Pick<Account, "id" | "name">,
  rawAmount: number,
): Omit<TaxIncomeRow, "id"> {
  const { fullAmount, taxablePortion } = splitClubbedIncome(rawAmount);
  return {
    ay,
    head: "other_sources",
    label: `${account.name} — clubbed minor income (Sec 64(1A))`,
    amount: taxablePortion,
    source_path: `${CLUBBED_SOURCE_PREFIX}${account.id}`,
    note: `full=${fullAmount}`,
    excluded: false,
  };
}

/** The account id a persisted row's `source_path` was written for, or null if it isn't one. */
export function clubbedAccountId(sourcePath: string | null): number | null {
  if (!sourcePath?.startsWith(CLUBBED_SOURCE_PREFIX)) return null;
  const id = Number(sourcePath.slice(CLUBBED_SOURCE_PREFIX.length));
  return Number.isInteger(id) ? id : null;
}

/** Recover the pre-exemption amount the user typed from a persisted row (falls back to its
 *  net `amount` for a row saved before this round-trip encoding existed). */
export function clubbedFullAmount(row: Pick<TaxIncomeRow, "note" | "amount">): number {
  const m = row.note?.match(/^full=(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : row.amount;
}
