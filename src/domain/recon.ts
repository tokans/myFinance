/**
 * Cross-document reconciliation matching — generalizes `sftCrossCheck.ts`'s
 * idiom (deterministic, amount/entity-based, purely a SUGGESTION the user
 * reviews) to two related but distinct problems:
 *
 *  1. Linking a bank transaction to the tax-document row it corresponds to
 *     (a bank debit for an advance-tax challan, a bank credit for a
 *     dividend/interest income row AIS/26AS also reported) — surfaced as a
 *     "matched with X" tag on the transaction.
 *  2. Detecting the SAME real-world event reported by two different
 *     documents (Form16's TDS row and 26AS's matching TDS row for the same
 *     employer) — surfaced as a duplicate candidate whose loser gets
 *     flagged `excluded` so totals stop double-counting it.
 *
 * Pure, no DB/React (same convention as `sftCrossCheck.ts`/`calc.ts`).
 * Output is a plain candidate list — the caller persists it via
 * `db/reconLinks.ts`'s `upsertSuggestedLinks`, which is itself idempotent
 * against already-reviewed pairs, so these functions can be re-run freely
 * (e.g. every time the reconciliation screen loads) without re-surfacing
 * something the user already dismissed or confirmed.
 */
import { entitiesMatch } from "./entityMatch";
import type { ReconKind, ReconLinkCandidate } from "@/db/reconLinks";

const AMOUNT_TOLERANCE = 1; // rupees — guards against paisa-rounding between a document figure and the bank statement

export interface ReconTransaction {
  id: number;
  debit: number | null;
  credit: number | null;
}

export interface ReconTaxPayment {
  id: number;
  amount: number;
  /** advance/self_assessment tax is paid by the user themselves (net-banking
   *  challan), so it's expected to show up as a bank DEBIT. tds_salary/
   *  tds_other/tcs is withheld by a third party before the user ever sees
   *  it — there's no matching bank movement to look for, so callers should
   *  only pass user-paid types here. */
  type: string;
}

export interface ReconTaxIncome {
  id: number;
  amount: number;
}

/** Bank debit <-> user-paid tax payment (advance/self-assessment challans). */
export function suggestTransactionPaymentLinks(
  transactions: ReconTransaction[],
  payments: ReconTaxPayment[],
): ReconLinkCandidate[] {
  const out: ReconLinkCandidate[] = [];
  for (const p of payments) {
    for (const t of transactions) {
      if (t.debit == null || Math.abs(t.debit - p.amount) > AMOUNT_TOLERANCE) continue;
      out.push({ a_kind: "transaction", a_id: t.id, b_kind: "tax_payment", b_id: p.id });
    }
  }
  return out;
}

/** Bank credit <-> reported income row (dividend/interest/etc. AIS or 26AS also saw). */
export function suggestTransactionIncomeLinks(
  transactions: ReconTransaction[],
  income: ReconTaxIncome[],
): ReconLinkCandidate[] {
  const out: ReconLinkCandidate[] = [];
  for (const r of income) {
    for (const t of transactions) {
      if (t.credit == null || Math.abs(t.credit - r.amount) > AMOUNT_TOLERANCE) continue;
      out.push({ a_kind: "transaction", a_id: t.id, b_kind: "tax_income", b_id: r.id });
    }
  }
  return out;
}

/** Documents/sources this app can produce tax_income/tax_payments rows from —
 *  used to tell "same document, re-imported" apart from "two different
 *  documents reporting the same event". A `source_path` that doesn't start
 *  with any of these (e.g. a manual return-builder edit, or an unrecognized
 *  prefix) is never treated as a duplicate candidate — better a missed
 *  suggestion than a wrong one. Also doubles as the friendly-name lookup for
 *  the UI (badges on the Tax Detail screen, the reconciliation screen's
 *  record labels). `LEDGER:` (`ledgerTaxSync.ts`'s "Refresh from
 *  transactions") is included even though it's not an imported document —
 *  it's a single aggregate figure per head (ALL dividend/interest bank
 *  credits summed into one row), same shape as a `SINGLE_SOURCE_HEADS` head,
 *  and a very common source of the same real dividend/interest AIS/TIS also
 *  report. */
const DOCUMENT_LABELS: Record<string, string> = {
  "26AS-PDF": "Form 26AS",
  "Form16-PDF": "Form 16",
  "AIS-PDF": "AIS (PDF)",
  "TIS-PDF": "TIS (PDF)",
  "AIS:": "AIS Utility",
  "CapitalGains-PDF": "Capital Gains Statement",
  "ITR.": "ITR import",
  "LEDGER:": "Bank ledger",
};
const KNOWN_DOCUMENT_PREFIXES = Object.keys(DOCUMENT_LABELS);

function sourceDocument(sourcePath: string | null): string | null {
  if (!sourcePath) return null;
  return KNOWN_DOCUMENT_PREFIXES.find((p) => sourcePath.startsWith(p)) ?? null;
}

/** Source labels for DISPLAY only (the Tax Detail "Source" column, badges) —
 *  deliberately NOT part of `DOCUMENT_LABELS`/`KNOWN_DOCUMENT_PREFIXES`, so
 *  these stay outside the auto-duplicate-candidate gate: a within-document
 *  repeat under `MANUAL:`/`CLUB:` can be legitimate (a return-builder edit
 *  replacing one head at a time; a clubbed-income row per dependant). */
const OTHER_SOURCE_LABELS: Record<string, string> = {
  "MANUAL:": "Manual entry",
  "CLUB:": "Clubbed income",
};

/** Friendly document/source name for a `source_path` (e.g. `"Form16-PDF"` ->
 *  `"Form 16"`), or null for an unrecognized/absent source. Covers both the
 *  cross-document-recon-eligible sources and the display-only ones. */
export function documentLabelForSource(sourcePath: string | null): string | null {
  if (!sourcePath) return null;
  const known = sourceDocument(sourcePath);
  if (known) return DOCUMENT_LABELS[known];
  const other = Object.keys(OTHER_SOURCE_LABELS).find((p) => sourcePath.startsWith(p));
  return other ? OTHER_SOURCE_LABELS[other] : null;
}

/** Within a small relative tolerance — official figures from different
 *  documents for the same event should match closely, but not always to the
 *  paisa (rounding differs by source). This is the gate for even suggesting
 *  a duplicate candidate at all; see `RECON_NOTE_EXACT`/`RECON_NOTE_DISCREPANCY`
 *  for the finer-grained tier within it. */
function amountsClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff < 1 || diff <= Math.max(Math.abs(a), Math.abs(b)) * 0.02;
}

/** `amountsClose`'s tolerance band expressed as a function of one (larger)
 *  amount alone — used to decide, in an amount-sorted scan, how far ahead a
 *  duplicate candidate could possibly still be. */
function amountToleranceBand(amount: number): number {
  return Math.max(1, Math.abs(amount) * 0.02);
}

/** Sorts by amount ascending — duplicate/near-duplicate rows always land
 *  near each other this way, so the O(n^2) all-pairs scan below can stop
 *  widening its window once the gap exceeds every tolerance that could
 *  possibly still apply, instead of comparing every pair regardless of how
 *  far apart their amounts are. */
function byAmountAscending<T extends { amount: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.amount - b.amount);
}

/** Emits a candidate with the lower-id record as `a` — matches
 *  `db/reconLinks.ts`'s `normalizePair` convention, so the pair's shape
 *  doesn't depend on which of the two an amount-sorted scan happened to
 *  visit first. */
function orderedPair<K extends ReconKind>(
  x: { id: number }, y: { id: number }, kind: K, note: string,
): ReconLinkCandidate {
  const [a, b] = x.id <= y.id ? [x, y] : [y, x];
  return { a_kind: kind, a_id: a.id, b_kind: kind, b_id: b.id, note };
}

/** Same figure, differing only by paisa-rounding between sources — safe to
 *  auto-reconcile (exclude the duplicate) without a human reviewing it first.
 *  Anything that only cleared the looser `amountsClose` band is a genuine
 *  discrepancy and stays `RECON_NOTE_DISCREPANCY`. */
function amountsExact(a: number, b: number): boolean {
  return Math.abs(a - b) < 1;
}

/** Tags on a duplicate-candidate `ReconLinkCandidate.note` — read back by
 *  `db/reconLinks.ts`'s `runAutoRecon` (auto-confirm `EXACT` and
 *  `STANDARD_DEDUCTION`) and by the UI (which tier of badge to render). A
 *  confirmed `DISCREPANCY` link has its `note` overwritten with the user's
 *  typed reason instead (see `reconNoteReasonLabel`). */
export const RECON_NOTE_EXACT = "exact";
export const RECON_NOTE_DISCREPANCY = "discrepancy";
export const RECON_NOTE_STANDARD_DEDUCTION = "standard_deduction";
/** Default note for a user-initiated manual duplicate mark (Tax Detail's row
 *  selection) with no typed reason — the matcher's heuristics (known source
 *  documents, head/type + amount, entity/label fuzzy-match) don't cover
 *  every real case, so the user can flag two rows themselves. */
export const RECON_NOTE_MANUAL = "manual";
/** Default note for a user-marked "these N detail rows sum to that one
 *  aggregate row" group (e.g. AIS's 4 quarterly interest entries vs. one
 *  annual total the bank statement/26AS reports) — a different relationship
 *  from a plain duplicate: the detail rows are legitimately different
 *  amounts, but counting both the detail group AND the aggregate double-counts
 *  the same money, so exactly one side should count. */
export const RECON_NOTE_SUM_GROUP = "sum_group";

/** Standard deduction u/s 16(ia), FY 2025-26 / AY 2026-27 — ₹75,000 under the
 *  new regime (default u/s 115BAC), ₹50,000 under the old regime. MUST be
 *  re-verified against the Finance Act for future years, same caveat as
 *  `taxCompute.ts`'s slabs. This is the single most common reason a salary
 *  figure differs across documents: AIS/TIS/ITR report the GROSS salary a
 *  deductor paid (pre-deduction), while Form 16 Part B item 6 ("Income
 *  chargeable under the head 'Salaries'") is already net of it — not a data
 *  conflict, just two different stages of the same figure. */
const STANDARD_DEDUCTION_AMOUNTS = [75000, 50000];
/** Headroom around the flat standard-deduction figure for the other (usually
 *  small) Section 16 items Form 16 item 6 also nets out alongside it —
 *  chiefly professional tax u/s 16(iii) (commonly capped ~₹2,500/yr by
 *  state), occasionally entertainment allowance u/s 16(ii) for government
 *  employees. Kept tight since this tier auto-excludes a row without a human
 *  reviewing it — a wider band would risk silently dropping a genuinely
 *  wrong figure that happens to land nearby. */
const STANDARD_DEDUCTION_TOLERANCE = 3000;

/** If `diff` (an absolute salary-amount gap) is within tolerance of a known
 *  standard-deduction figure, returns that figure; otherwise null. */
function matchStandardDeduction(diff: number): number | null {
  return STANDARD_DEDUCTION_AMOUNTS.find((sd) => Math.abs(diff - sd) <= STANDARD_DEDUCTION_TOLERANCE) ?? null;
}

/** Widest gap `matchStandardDeduction` can ever accept — the salary-duplicate
 *  scan's amount-sorted window needs this alongside `amountToleranceBand` so
 *  it doesn't stop early and miss a standard-deduction pair, whose gap (up to
 *  ~78,000) is well outside the normal 2%-of-amount "close" band. */
const MAX_STANDARD_DEDUCTION_GAP = Math.max(...STANDARD_DEDUCTION_AMOUNTS) + STANDARD_DEDUCTION_TOLERANCE;

/** Human-readable reason for a CONFIRMED duplicate/discrepancy link's
 *  `note` — the two auto-tiers get a fixed label, anything else is a user's
 *  own typed reason (verbatim) from confirming a discrepancy manually. */
export function reconNoteReasonLabel(note: string | null): string {
  if (note === RECON_NOTE_EXACT) return "Exact match";
  if (note === RECON_NOTE_STANDARD_DEDUCTION) return "Standard deduction";
  if (note === RECON_NOTE_MANUAL) return "Manually marked as duplicate";
  if (note === RECON_NOTE_SUM_GROUP) return "Sum of a group of rows";
  return note?.trim() || "Confirmed manually";
}

export interface ReconDuplicatePayment {
  id: number;
  amount: number;
  type: string;
  source_path: string | null;
  note: string | null;
}

/** An ISO `YYYY-MM-DD` embedded in a payment row's free-text `note` — the
 *  only place a payment's date lives today (there's no structured date
 *  column on `tax_payments`). Only ever present for an "advance" challan
 *  (`aisPdf.ts`/`tisPdf.ts` write `"Advance-tax challan deposited
 *  <ISO-date>, from ..."`); every other type's note (a TAN, or nothing) has
 *  no date to find, so this is a best-effort extra signal, not something
 *  every row can supply. */
function noteDate(note: string | null): string | null {
  return note?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

/** Same-type, same-amount tax_payments rows from two different KNOWN source
 *  documents — the classic Form16-vs-26AS TDS double-count. Matched on
 *  type+amount alone, with NO payer-name check: a deductor's name is free
 *  text that different documents spell differently for the SAME real
 *  withholding (26AS's registered deductor name vs. Form16's employer-header
 *  formatting vs. AIS/TIS's own rendering), so requiring `entitiesMatch` on
 *  it was silently blocking real cross-document duplicates — same trade-off
 *  already made for `other_sources` income (see `OTHER_SOURCES_HEAD`) and
 *  for the same reason: type+amount is the more reliable cross-document
 *  signal than company-name text here. Where a deposit date IS available on
 *  both sides (`noteDate` — advance-tax challans), it still has to agree:
 *  a taxpayer can genuinely pay two DIFFERENT quarterly installments of the
 *  same amount, and only date tells those apart from the same challan
 *  reported twice. */
export function suggestDuplicatePaymentLinks(payments: ReconDuplicatePayment[]): ReconLinkCandidate[] {
  const out: ReconLinkCandidate[] = [];
  const sorted = byAmountAscending(payments);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const docA = sourceDocument(a.source_path);
    if (!docA) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      // Sorted ascending by amount, so the gap only grows as j increases; once it clears
      // the tolerance band (itself only ever wider for a larger amount), every further
      // candidate is further away still and would fail too — stop scanning this row.
      if (b.amount - a.amount > amountToleranceBand(b.amount)) break;
      const docB = sourceDocument(b.source_path);
      if (!docB || docA === docB) continue;
      if (a.type !== b.type) continue;
      if (!amountsClose(a.amount, b.amount)) continue;
      const [dateA, dateB] = [noteDate(a.note), noteDate(b.note)];
      if (dateA != null && dateB != null && dateA !== dateB) continue;
      out.push(orderedPair(a, b, "tax_payment", amountsExact(a.amount, b.amount) ? RECON_NOTE_EXACT : RECON_NOTE_DISCREPANCY));
    }
  }
  return out;
}

export interface ReconDuplicateIncome {
  id: number;
  amount: number;
  head: string;
  label: string;
  source_path: string | null;
}

/** Income heads where each document typically contributes ONE aggregate
 *  figure, not a per-payer breakdown — the `label` is document-phrased prose
 *  ("Salary income (Form 16 Part B item 6)" vs. AIS's "Salary received
 *  (Section 192)") that will never fuzzy-match across documents even though
 *  it's the same real salary. Requiring `entitiesMatch` on these heads was
 *  silently blocking the single most common duplicate this function exists
 *  to catch. `dividend` is excluded — AIS/TIS commonly report several
 *  distinct per-security payouts there, so label matching still earns its
 *  keep. `other_sources` is deliberately NOT in this set (its same-document
 *  dedup stays gated below), even though its cross-document label check is
 *  turned off too — see `isAggregatePair`. */
const SINGLE_SOURCE_HEADS = new Set(["salary", "house_property", "business", "exempt", "cg_short", "cg_long"]);

/** `other_sources` is the head TIS/26AS fall back to for almost anything that
 *  isn't recognizably a dividend (`tisPdf.ts` only special-cases `/dividend/i`
 *  in the category text; `pdf26as.ts`'s `isDividendRow` only special-cases
 *  section 194) — so the SAME real income can land here labeled with a
 *  document-specific category name ("Salary") on one side and a deductor's
 *  registered company name ("JM Financial Services Limited") on the other,
 *  which will never fuzzy-match. Confirmed with the app's owner: company/
 *  category naming is inconsistent enough across documents that amount+head
 *  alone is the more reliable cross-document signal here, same trade-off
 *  already accepted for `SINGLE_SOURCE_HEADS`. Unlike those heads, `other_sources`
 *  keeps requiring different documents (the same-document skip below still
 *  applies, since one document CAN report several distinct same-amount
 *  `other_sources` payers) — only the label check is dropped. */
const OTHER_SOURCES_HEAD = "other_sources";

/** Same-head, same-amount tax_income rows from two different KNOWN source
 *  documents — label/entity matching is an extra filter only for heads that
 *  commonly have multiple distinct real-world sources (see
 *  `SINGLE_SOURCE_HEADS`); for the rest, head+amount alone is the signal.
 *  Pairs from the SAME document are normally skipped (two genuinely distinct
 *  entries can share an amount by coincidence — two FDs with identical
 *  interest, two dividend payouts of the same size), but for a
 *  `SINGLE_SOURCE_HEADS` head a single document only ever contributes ONE
 *  aggregate row for it — a second one with the identical amount is a
 *  parsing/import artifact (e.g. a table row duplicated across a page
 *  boundary), not a second genuine income, so it's safe to flag/exclude too. */
export function suggestDuplicateIncomeLinks(income: ReconDuplicateIncome[]): ReconLinkCandidate[] {
  const out: ReconLinkCandidate[] = [];
  const sorted = byAmountAscending(income);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const docA = sourceDocument(a.source_path);
    if (!docA) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const gap = b.amount - a.amount;
      // Same early-stop as `suggestDuplicatePaymentLinks`, widened to also cover the
      // salary standard-deduction band (~78,000) so a real match past the normal 2%
      // "close" tolerance isn't cut off before it's ever checked.
      const maxGap = Math.max(amountToleranceBand(b.amount), a.head === "salary" ? MAX_STANDARD_DEDUCTION_GAP : 0);
      if (gap > maxGap) break;
      const docB = sourceDocument(b.source_path);
      if (!docB) continue;
      if (a.head !== b.head) continue;
      if (docA === docB && !SINGLE_SOURCE_HEADS.has(a.head)) continue;
      // A ledger-derived row (`LEDGER:`) is ALWAYS a single aggregate across every
      // categorized bank transaction for that head, never a per-payer breakdown — same
      // shape as a SINGLE_SOURCE_HEADS head, so it exempts label matching too, regardless
      // of what head it's under (dividend normally still requires it). `other_sources` is
      // exempted unconditionally — see `OTHER_SOURCES_HEAD`.
      const isAggregatePair =
        SINGLE_SOURCE_HEADS.has(a.head) || a.head === OTHER_SOURCES_HEAD || docA === "LEDGER:" || docB === "LEDGER:";
      // Salary gets an extra gate beyond the normal 2%-of-max band: a gap that lands on a
      // known standard-deduction figure is expected (gross vs. net-of-Section-16 salary),
      // not a conflict — recognize it even when it's well outside `amountsClose`'s range.
      const standardDeduction = a.head === "salary" ? matchStandardDeduction(gap) : null;
      if (!amountsClose(a.amount, b.amount) && standardDeduction == null) continue;
      if (!isAggregatePair && !entitiesMatch(a.label, b.label)) continue;
      const note = standardDeduction != null
        ? RECON_NOTE_STANDARD_DEDUCTION
        : amountsExact(a.amount, b.amount) ? RECON_NOTE_EXACT : RECON_NOTE_DISCREPANCY;
      out.push(orderedPair(a, b, "tax_income", note));
    }
  }
  return out;
}
