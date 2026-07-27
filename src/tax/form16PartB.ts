/**
 * Form 16 Part B (the salary/deductions/tax-computation annexure) — a long
 * sequence of numbered ("1.", "2.", ... "21.") and lettered ("(a)", "(b)", ...)
 * statutory line items, each ending in one or more Rupee amounts. The exact
 * descriptive wording is dictated by the CBDT-prescribed Part B format (it's
 * a legal certificate, not free employer choice), so item markers reliably
 * appear on the SAME row as their trailing amount(s) even when the
 * surrounding descriptive text wraps across other rows — confirmed against a
 * real Form 16 (e.g. a row can read just "(b) 250830.00" with its label
 * "Value of perquisites under section 17(2)..." spread across the rows
 * before/after it).
 *
 * Deliberately generic (marker + best-effort inline label + amounts) rather
 * than a hand-mapped list of ~30 named fields: it captures everything
 * present without betting on a fixed field count/order that could silently
 * misattribute a value if one document renders a line differently. Deciding
 * which of these captured items should feed actual tax computation is a
 * separate, later step — this only transcribes what's on the page.
 */
import { parseAmount } from "@/statements/amount";
import { textLines, type DocModel } from "@scandoc/core/docmodel";

const TOP_LEVEL_ITEM = /^(\d{1,2})\.\s*(.*?)\s*((?:[\d,]+\.\d{1,2}\s*)+)$/;
// A top-level section header with no amount of its own (e.g. "1. Gross
// Salary Rs. Rs." or "10. Deductions under Chapter VI-A Gross Amount
// Deductible Amount") — still needed to know which section a later lettered
// sub-item belongs to. Requires at least one letter in the remainder so a
// bare decimal amount like "0.00" (which also matches "digits, dot, digits")
// isn't misread as item marker "0" with label "00" — a real bug found
// against a real document.
const TOP_LEVEL_HEADER_ONLY = /^(\d{1,2})\.\s*(.*[A-Za-z].*)$/;
const SUB_ITEM = /^\(([a-z])\)\s*(.*?)\s*((?:[\d,]+\.\d{1,2}\s*)+)$/i;
// Part A's own last page carries a numbered "Notes:" list ("1. Part B
// (Annexure) of the certificate...", "2. If an assessee is employed...")
// that ALSO matches the "N. text" shape — without scoping to Part B's own
// pages, those notes collide with Part B's real "1."/"2."/... markers
// (confirmed against a real document). "PART B" is Form 16's own page
// heading marking where the annexure actually starts.
const PART_B_MARKER = /^part\s*b$/i;

export interface Form16PartBItem {
  /** e.g. "1", "10(a)" — sub-items are qualified by the top-level item they
   *  most recently followed, since a bare "(a)" repeats under every section. */
  marker: string;
  /** Whatever descriptive text shared the row with the marker — often
   *  partial (see module doc comment); blank is common and not an error. */
  label: string;
  /** Usually one amount; some Chapter VI-A rows report Gross/Qualifying/
   *  Deductible as three amounts on the same row. */
  amounts: number[];
}

/** Parses every numbered/lettered Part B line item found in the document,
 *  starting only from the "PART B" page heading — Part A's own numbered
 *  notes/legend list is left alone rather than colliding with Part B's markers. */
export function parseForm16PartB(model: DocModel): Form16PartBItem[] {
  const items: Form16PartBItem[] = [];
  let currentTopLevel = "";
  let inPartB = false;

  for (const line of textLines(model)) {
    const text = line.replace(/\s+/g, " ").trim();

    if (!inPartB) {
      if (PART_B_MARKER.test(text)) inPartB = true;
      continue;
    }

    const top = TOP_LEVEL_ITEM.exec(text);
    if (top) {
      currentTopLevel = top[1];
      items.push({ marker: top[1], label: top[2].trim(), amounts: parseAmounts(top[3]) });
      continue;
    }

    const topHeaderOnly = TOP_LEVEL_HEADER_ONLY.exec(text);
    if (topHeaderOnly) {
      currentTopLevel = topHeaderOnly[1];
      items.push({ marker: topHeaderOnly[1], label: topHeaderOnly[2].trim(), amounts: [] });
      continue;
    }

    const sub = SUB_ITEM.exec(text);
    if (sub) {
      const marker = currentTopLevel ? `${currentTopLevel}(${sub[1]})` : `(${sub[1]})`;
      items.push({ marker, label: sub[2].trim(), amounts: parseAmounts(sub[3]) });
    }
  }

  return items;
}

function parseAmounts(raw: string): number[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((s) => parseAmount(s))
    .filter((n): n is number => n !== null);
}
