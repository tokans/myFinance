import type { TaxIncomeRow, TaxPaymentRow } from "@/db/tax";

/** Human-readable labels for the fixed income-head/payment-type vocabulary —
 *  shared by `pages/TaxDetail.tsx`'s display and `tax/caReconciliation.ts`'s
 *  category matching (both need the SAME label text). */
export const HEAD_LABELS: Record<TaxIncomeRow["head"], string> = {
  salary: "Salary",
  house_property: "House property",
  other_sources: "Other sources",
  dividend: "Dividend income",
  cg_short: "Short-term capital gains",
  cg_long: "Long-term capital gains",
  business: "Business / profession",
  exempt: "Exempt income",
};

export const PAYMENT_LABELS: Record<TaxPaymentRow["type"], string> = {
  tds_salary: "TDS — salary",
  tds_other: "TDS — other",
  advance: "Advance tax",
  self_assessment: "Self-assessment tax",
  tcs: "TCS",
};

/** Payment types the filer pays directly to the government. There is no
 *  deductor to name on one, so a missing payer is the NORMAL, complete state —
 *  `itrParser.ts` already excludes these from its unnamed-payer count for the
 *  same reason. */
const SELF_PAID_TYPES = new Set<TaxPaymentRow["type"]>(["advance", "self_assessment"]);

/**
 * How to name a payment row in a list.
 *
 * A TDS/TCS row is identified by WHO withheld the tax, so a missing payer
 * there is a real gap worth flagging. An advance-tax challan has no payer by
 * construction — labelling it "(unnamed)" reports a parse failure for a row
 * that is perfectly complete, which is exactly how a correctly imported set
 * of AIS Part B3 challans came to look broken.
 */
export function paymentRowLabel(row: Pick<TaxPaymentRow, "type" | "payer_name">): { label: string; sub: string } {
  const typeLabel = PAYMENT_LABELS[row.type];
  if (row.payer_name?.trim()) return { label: row.payer_name, sub: typeLabel };
  if (SELF_PAID_TYPES.has(row.type)) return { label: typeLabel, sub: "Paid by you" };
  return { label: "(unnamed)", sub: typeLabel };
}
