/**
 * Semantic layer over `form16PartB.ts`'s generic marker+label+amounts
 * transcription. Form 16 Part B's item numbering is CBDT-prescribed and
 * stable (confirmed by real documents: item 12 is always "Total taxable
 * income (9-11)", item 19 is always the TDS line — see form16PartB.test.ts) —
 * item 6 is "Income chargeable under the head Salaries" and item 10's
 * lettered sub-items are the Chapter VI-A deductions, item 11 their
 * aggregate. Item labels are frequently blank on their own row (the label
 * text wraps onto a neighbouring row and form16PartB.ts doesn't reattach
 * it — see that module's doc comment), so this only uses the label as a
 * defensive sanity check against the fixed item position, never as the
 * primary signal: a missing/blank label is normal, not a reason to
 * distrust the marker.
 *
 * Same conservative posture as the rest of the document-import pipeline:
 * degrade to null/skip rather than guess a wrong figure that feeds tax
 * computation.
 */
import type { TaxDeductionRow, TaxIncomeRow } from "@/db/tax";
import { SECTION_TO_KEY } from "./itrBuilder";
import type { Form16PartBItem } from "./form16PartB";
import type { Form16ParseResult } from "./form16";

// A label that contradicts item 6 being "Income chargeable under the head
// Salaries" — signals the item numbering didn't land where expected (a
// different document layout, or a mis-parse), so don't trust the amount.
const SALARY_CONTRADICTS =
  /gross\s+salary|deductions?\s+under|chapter\s*vi-?a|total\s+taxable|allowances?\s+exempt/i;

function lastAmount(item: Form16PartBItem): number | null {
  return item.amounts.length > 0 ? item.amounts[item.amounts.length - 1] : null;
}

function findItem(items: Form16PartBItem[], marker: string): Form16PartBItem | undefined {
  return items.find((i) => i.marker === marker);
}

export interface SalaryIncomeResult {
  amount: number | null;
  warning: string | null;
}

/** Item 6: "Income chargeable under the head 'Salaries'" — the figure the
 *  return builder's "Salary / pension (chargeable)" field wants. */
export function extractSalaryIncome(items: Form16PartBItem[]): SalaryIncomeResult {
  const item = findItem(items, "6");
  if (!item) {
    return {
      amount: null,
      warning:
        "Couldn't find Part B item 6 (\"Income chargeable under the head Salaries\") — salary income wasn't auto-filled from Form 16.",
    };
  }
  if (item.label && SALARY_CONTRADICTS.test(item.label)) {
    return {
      amount: null,
      warning: `Part B item 6 was expected to be "Income chargeable under the head Salaries" but read "${item.label}" — salary income wasn't auto-filled; enter it manually.`,
    };
  }
  const amount = lastAmount(item);
  if (amount === null) {
    return {
      amount: null,
      warning:
        "Part B item 6 (\"Income chargeable under the head Salaries\") had no amount on its row — salary income wasn't auto-filled from Form 16.",
    };
  }
  return { amount, warning: null };
}

// Builds one case-insensitive regex per Chapter VI-A section code (reusing
// itrBuilder.ts's SECTION_TO_KEY vocabulary so the two lists never drift).
// A trailing `\b` is only added for codes that end in a word character
// ("80C") — codes ending in ")" ("80CCD(1B)") are already naturally bounded
// by the literal paren, and `\b` right after `)` would wrongly require a
// word character to immediately follow it in the source text.
function codeToPattern(code: string): string {
  const idx = code.indexOf("(");
  if (idx === -1) return code;
  const base = code.slice(0, idx);
  const paren = code.slice(idx).replace(/[()]/g, (m) => `\\${m}`);
  return `${base}\\s*${paren}`;
}

const SECTION_PATTERNS: [string, RegExp][] = Object.keys(SECTION_TO_KEY)
  .sort((a, b) => b.length - a.length)
  .map((code) => [code, new RegExp(`\\b${codeToPattern(code)}${code.endsWith(")") ? "" : "\\b"}`, "i")]);

function matchSectionCode(label: string): string | null {
  for (const [code, re] of SECTION_PATTERNS) {
    if (re.test(label)) return code;
  }
  return null;
}

export interface ChapterViaDeductionRow {
  section: string;
  label: string;
  amount: number;
}

export interface ChapterViaResult {
  rows: ChapterViaDeductionRow[];
  /** Item 11 ("Aggregate of deductible amount under Chapter VI-A"), for the
   *  consistency check in `form16.ts` — not written anywhere itself. */
  aggregateFromForm: number | null;
  /** Set when the aggregate and the matched-sections sum disagree by more
   *  than rounding, meaning some sub-item wasn't recognized. */
  warning: string | null;
}

/** Item 10's lettered sub-items, each naming a Chapter VI-A section — matched
 *  against the same section-code vocabulary the return builder/ITR builder
 *  use. Sub-items whose label doesn't carry a recognizable section code are
 *  left unmatched (visible only in the raw Part B data) rather than guessed. */
export function extractChapterViaDeductions(items: Form16PartBItem[]): ChapterViaResult {
  const bySection = new Map<string, ChapterViaDeductionRow>();

  for (const item of items) {
    if (!/^10\(/.test(item.marker)) continue;
    const section = matchSectionCode(item.label);
    if (!section) continue;
    const amount = lastAmount(item);
    if (amount === null || amount <= 0) continue;

    const existing = bySection.get(section);
    if (existing) existing.amount += amount;
    else bySection.set(section, { section, label: item.label || section, amount });
  }

  const rows = Array.from(bySection.values());
  const aggregateFromForm = lastAmount(findItem(items, "11") ?? { marker: "11", label: "", amounts: [] });
  const matchedSum = rows.reduce((sum, r) => sum + r.amount, 0);

  let warning: string | null = null;
  if (aggregateFromForm !== null && aggregateFromForm > 0 && Math.abs(aggregateFromForm - matchedSum) > 1) {
    const fmt = (n: number) => n.toLocaleString("en-IN");
    warning =
      rows.length > 0
        ? `Form 16 reports ₹${fmt(aggregateFromForm)} total Chapter VI-A deductions (item 11) but only ₹${fmt(matchedSum)} across ${rows.length} section(s) could be automatically matched — check Part B below and add the rest manually in the return builder.`
        : `Form 16 reports ₹${fmt(aggregateFromForm)} total Chapter VI-A deductions (item 11) but none of the section sub-items could be automatically matched — add them manually in the return builder.`;
  }

  return { rows, aggregateFromForm, warning };
}

/** Item 6 → a single `salary` income row, same conservative "skip rather
 *  than guess" behaviour as `extractSalaryIncome`. */
export function form16ToIncomeRows(result: Form16ParseResult, ay: string): Omit<TaxIncomeRow, "id">[] {
  const { amount } = extractSalaryIncome(result.partB);
  if (amount === null || amount <= 0) return [];
  return [
    {
      ay,
      head: "salary",
      label: "Salary income (Form 16 Part B item 6)",
      amount,
      source_path: "Form16-PDF",
      note: "Income chargeable under the head \"Salaries\", per Form 16 Part B item 6.",
      excluded: false,
    },
  ];
}

/** Item 10's matched Chapter VI-A sub-items → one deduction row per section. */
export function form16ToDeductionRows(result: Form16ParseResult, ay: string): Omit<TaxDeductionRow, "id">[] {
  const { rows } = extractChapterViaDeductions(result.partB);
  return rows.map((r) => ({
    ay,
    section: r.section,
    label: r.label,
    amount: r.amount,
    source_path: "Form16-PDF",
    note: `Chapter VI-A deduction, per Form 16 Part B item 10 (${r.section}).`,
  }));
}
