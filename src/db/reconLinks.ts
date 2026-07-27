import { query, exec, T } from "./client";
import { setIncomeExcluded, setPaymentExcluded, listIncomeAll, listPaymentsAll } from "./tax";
import {
  suggestDuplicatePaymentLinks, suggestDuplicateIncomeLinks,
  RECON_NOTE_EXACT, RECON_NOTE_DISCREPANCY, RECON_NOTE_STANDARD_DEDUCTION, RECON_NOTE_MANUAL, RECON_NOTE_SUM_GROUP,
} from "../domain/recon";

/** The reconcilable record kinds a recon link can point at. A link is a
 *  generic "these two records represent/might represent the same real-world
 *  thing" pair — either a bank transaction matched to a tax-document row, or
 *  two tax-document rows from different source documents that duplicate
 *  each other. See `auxSql.ts`'s `RECON_LINKS_TABLE` doc comment for why
 *  this stays device-local (polymorphic local ids, never synced). */
export type ReconKind = "transaction" | "tax_income" | "tax_payment" | "ais_sft" | "tax_refund";
export type ReconLinkStatus = "suggested" | "confirmed" | "dismissed";

export interface ReconLinkRow {
  id: number;
  a_kind: ReconKind;
  a_id: number;
  b_kind: ReconKind;
  b_id: number;
  status: ReconLinkStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReconLinkCandidate {
  a_kind: ReconKind;
  a_id: number;
  b_kind: ReconKind;
  b_id: number;
  note?: string | null;
}

/** Normalizes a pair to a stable (a, b) order (by kind, then id) so the same
 *  real-world pair always lands in the unique index the same way regardless
 *  of which side a caller happened to pass first. */
function normalizePair<T extends { a_kind: ReconKind; a_id: number; b_kind: ReconKind; b_id: number }>(pair: T): T {
  if (pair.a_kind < pair.b_kind || (pair.a_kind === pair.b_kind && pair.a_id <= pair.b_id)) return pair;
  return { ...pair, a_kind: pair.b_kind, a_id: pair.b_id, b_kind: pair.a_kind, b_id: pair.a_id } as T;
}

/** Every link touching one record, in either position — used to render a
 *  transaction's "matched with N document(s)" tags, or a tax row's
 *  duplicate-candidate badge. */
export async function listLinksFor(kind: ReconKind, id: number): Promise<ReconLinkRow[]> {
  return query<ReconLinkRow>(
    `SELECT * FROM ${T.reconLinks} WHERE (a_kind = ? AND a_id = ?) OR (b_kind = ? AND b_id = ?) ORDER BY id`,
    [kind, id, kind, id],
  );
}

/** All links, for the reconciliation screen's overview. */
export async function listAllLinks(): Promise<ReconLinkRow[]> {
  return query<ReconLinkRow>(`SELECT * FROM ${T.reconLinks} ORDER BY id`);
}

/**
 * Inserts freshly-computed 'suggested' candidates, skipping any pair that
 * already has a link (in ANY status) — so re-running the matcher after the
 * user has confirmed/dismissed some candidates doesn't resurrect or
 * duplicate them. Idempotent: safe to call on every visit to the
 * reconciliation screen.
 */
export async function upsertSuggestedLinks(candidates: ReconLinkCandidate[]): Promise<void> {
  for (const raw of candidates) {
    const c = normalizePair(raw);
    await exec(
      `INSERT OR IGNORE INTO ${T.reconLinks} (a_kind, a_id, b_kind, b_id, status, note) VALUES (?, ?, ?, ?, 'suggested', ?)`,
      [c.a_kind, c.a_id, c.b_kind, c.b_id, c.note ?? null],
    );
  }
}

/** Looks up a tax_income/tax_payment row's amount by id, for the
 *  amount-aware exclusion `confirmLink` needs on a `RECON_NOTE_STANDARD_DEDUCTION`
 *  pair — unlike every other tier, the two sides here are NOT expected to be
 *  equal, so "which one do we exclude" can't be decided by the generic
 *  a-side/b-side id-order convention. */
async function amountOf(kind: ReconKind, id: number): Promise<number | null> {
  const table = kind === "tax_income" ? T.taxIncome : kind === "tax_payment" ? T.taxPayments : null;
  if (!table) return null;
  const rows = await query<{ amount: number }>(`SELECT amount FROM ${table} WHERE id = ?`, [id]);
  return rows[0]?.amount ?? null;
}

/**
 * Confirms a link. If either side of the pair is a tax_income/tax_payment
 * row, one side is marked `excluded` — the "these two documents reported the
 * same real-world event, don't double-count it" case. A transaction<->document
 * match has no such side effect; confirming it only changes the link's
 * status (the transaction gets its "matched with X" tag from the confirmed
 * link itself, not from any exclusion).
 *
 * `reason`, when given, overwrites the link's `note` with the user's own
 * explanation — used when manually confirming a `RECON_NOTE_DISCREPANCY`
 * pair from the Reconciliation screen (a delta recon requires a reason to
 * accept). Omit it for the auto-confirm tiers (`RECON_NOTE_EXACT`/
 * `RECON_NOTE_STANDARD_DEDUCTION`), whose `note` is already a
 * self-explanatory machine tag — see `reconNoteReasonLabel`.
 */
export async function confirmLink(id: number, reason?: string): Promise<void> {
  const rows = await query<ReconLinkRow>(`SELECT * FROM ${T.reconLinks} WHERE id = ?`, [id]);
  const link = rows[0];
  if (!link) return;
  const note = reason?.trim() ? reason.trim() : link.note;
  await exec(`UPDATE ${T.reconLinks} SET status = 'confirmed', note = ?, updated_at = datetime('now') WHERE id = ?`, [note, id]);

  const isDuplicatePair =
    (link.a_kind === "tax_income" || link.a_kind === "tax_payment") &&
    (link.b_kind === "tax_income" || link.b_kind === "tax_payment");
  if (!isDuplicatePair) return;

  if (link.note === RECON_NOTE_STANDARD_DEDUCTION) {
    // The two sides genuinely differ (gross vs. net-of-standard-deduction salary) —
    // keep the smaller (net) figure, exclude the larger (gross) one.
    const [aAmount, bAmount] = await Promise.all([amountOf(link.a_kind, link.a_id), amountOf(link.b_kind, link.b_id)]);
    if (aAmount != null && bAmount != null) {
      const [excludeKind, excludeId] = aAmount >= bAmount ? [link.a_kind, link.a_id] : [link.b_kind, link.b_id];
      if (excludeKind === "tax_income") await setIncomeExcluded(excludeId, true);
      else await setPaymentExcluded(excludeId, true);
      return;
    }
    // Fall through to the default below if either amount lookup somehow came up empty.
  }

  // The "loser" is the b-side by convention (normalizePair keeps a stable
  // order, so this is deterministic — whichever record the matcher listed
  // second is the one flagged out of totals).
  if (link.b_kind === "tax_income") await setIncomeExcluded(link.b_id, true);
  else await setPaymentExcluded(link.b_id, true);
}

/** Marks a candidate as reviewed-and-rejected so it doesn't resurface on the
 *  next `upsertSuggestedLinks` call. Never touches `excluded` — dismissing a
 *  duplicate suggestion means "these are NOT the same event", so nothing
 *  should be excluded. */
export async function dismissLink(id: number): Promise<void> {
  await exec(`UPDATE ${T.reconLinks} SET status = 'dismissed', updated_at = datetime('now') WHERE id = ?`, [id]);
}

/** Undoes a confirmed duplicate-pair link: clears the exclusion it set and
 *  reverts the link back to 'suggested' so it can be reviewed again. Clears
 *  BOTH sides unconditionally rather than re-deriving which side `confirmLink`
 *  excluded — that decision differs by tier (arbitrary b-side vs. the
 *  smaller-amount side for `RECON_NOTE_STANDARD_DEDUCTION`), and clearing an
 *  already-included row's `excluded` flag is a harmless no-op. */
export async function unconfirmLink(id: number): Promise<void> {
  const rows = await query<ReconLinkRow>(`SELECT * FROM ${T.reconLinks} WHERE id = ?`, [id]);
  const link = rows[0];
  if (!link) return;
  await exec(`UPDATE ${T.reconLinks} SET status = 'suggested', updated_at = datetime('now') WHERE id = ?`, [id]);

  const isDuplicatePair =
    (link.a_kind === "tax_income" || link.a_kind === "tax_payment") &&
    (link.b_kind === "tax_income" || link.b_kind === "tax_payment");
  if (!isDuplicatePair) return;

  for (const [kind, recordId] of [[link.a_kind, link.a_id], [link.b_kind, link.b_id]] as const) {
    if (kind === "tax_income") await setIncomeExcluded(recordId, false);
    else await setPaymentExcluded(recordId, false);
  }
}

export interface AutoReconResult {
  /** Newly (or already) exact-matched duplicates excluded from totals this run. */
  autoConfirmed: number;
  /** Salary pairs auto-explained by the standard deduction and excluded — see
   *  `domain/recon.ts`'s `RECON_NOTE_STANDARD_DEDUCTION`. */
  standardDeductionMapped: number;
  /** Close-but-not-identical pairs left 'suggested' for a human to resolve. */
  discrepancies: number;
}

/**
 * Computes cross-document duplicate candidates for one assessment year's
 * income/payments, persists them as 'suggested' links, then auto-confirms
 * the two self-explanatory tiers (`domain/recon.ts`'s `RECON_NOTE_EXACT` —
 * the same figure reported twice, differing only by paisa-rounding — and
 * `RECON_NOTE_STANDARD_DEDUCTION` — a salary gap that matches the standard
 * deduction, i.e. gross vs. net-of-Section-16 salary, not a conflict). A
 * looser `RECON_NOTE_DISCREPANCY` match is left 'suggested' so the
 * Reconciliation screen and Tax Detail's inline badges can surface it for a
 * human to resolve (with a reason — see `confirmLink`), instead of silently
 * excluding a genuinely different figure.
 *
 * Idempotent and cheap to call on every tax-year page load (and re-runnable
 * on demand — see Tax Detail's "Check for duplicates" button, for records
 * imported before this logic existed or before a matcher improvement):
 * `upsertSuggestedLinks` skips any pair that already has a link in ANY
 * status, so a user's prior dismiss/confirm/undo is never overwritten, and
 * re-confirming an already-confirmed link is a harmless no-op.
 */
export async function runAutoRecon(ay: string): Promise<AutoReconResult> {
  const [payments, income] = await Promise.all([listPaymentsAll(ay), listIncomeAll(ay)]);
  const candidates = [
    ...suggestDuplicatePaymentLinks(payments.map((p) => ({ id: p.id, amount: p.amount, type: p.type, source_path: p.source_path, note: p.note }))),
    ...suggestDuplicateIncomeLinks(income.map((r) => ({ id: r.id, amount: r.amount, head: r.head, label: r.label, source_path: r.source_path }))),
  ];
  await upsertSuggestedLinks(candidates);

  const paymentIds = new Set(payments.map((p) => p.id));
  const incomeIds = new Set(income.map((r) => r.id));
  const touches = (kind: ReconKind, id: number) =>
    (kind === "tax_payment" && paymentIds.has(id)) || (kind === "tax_income" && incomeIds.has(id));

  const allLinks = await listAllLinks();
  let autoConfirmed = 0;
  let standardDeductionMapped = 0;
  let discrepancies = 0;
  for (const l of allLinks) {
    if (!touches(l.a_kind, l.a_id) || !touches(l.b_kind, l.b_id)) continue;
    if (l.status !== "suggested") continue;
    if (l.note === RECON_NOTE_DISCREPANCY) { discrepancies++; continue; }
    if (l.note !== RECON_NOTE_EXACT && l.note !== RECON_NOTE_STANDARD_DEDUCTION) continue;
    await confirmLink(l.id);
    if (l.note === RECON_NOTE_STANDARD_DEDUCTION) standardDeductionMapped++;
    else autoConfirmed++;
  }
  return { autoConfirmed, standardDeductionMapped, discrepancies };
}

/**
 * Core of every user-initiated manual resolution: links each `keepIds[i]` to
 * each `excludeIds[j]` (same `kind`) as a confirmed pair tagged `note`, then
 * excludes every `excludeIds` row from totals. `keepIds` itself is never
 * touched — for the common single-survivor case that's a no-op; for
 * `markSumOfGroup`'s "keep the itemized rows" direction, `keepIds` has
 * several entries and none of them should be excluded.
 *
 * Upserts on the same (a_kind, a_id, b_kind, b_id) unique pair `upsertSuggestedLinks`
 * uses, so re-marking an already-linked pair just updates it (idempotent).
 */
async function linkAndExclude(
  kind: "tax_income" | "tax_payment", keepIds: number[], excludeIds: number[], note: string,
): Promise<void> {
  for (const excludeId of excludeIds) {
    for (const keepId of keepIds) {
      if (excludeId === keepId) continue;
      const pair = normalizePair({ a_kind: kind, a_id: keepId, b_kind: kind, b_id: excludeId });
      await exec(
        `INSERT INTO ${T.reconLinks} (a_kind, a_id, b_kind, b_id, status, note)
         VALUES (?, ?, ?, ?, 'confirmed', ?)
         ON CONFLICT(a_kind, a_id, b_kind, b_id) DO UPDATE SET status = 'confirmed', note = excluded.note, updated_at = datetime('now')`,
        [pair.a_kind, pair.a_id, pair.b_kind, pair.b_id, note],
      );
    }
    if (kind === "tax_income") await setIncomeExcluded(excludeId, true);
    else await setPaymentExcluded(excludeId, true);
  }
}

/**
 * User-initiated override for when `domain/recon.ts`'s automatic matcher
 * still doesn't catch two (or more) rows the user can see are the same
 * real-world figure — e.g. an amount/label combination its heuristics don't
 * cover. Marks each of `excludeIds` as a confirmed duplicate of `keepId` and
 * excludes it from totals, going straight to 'confirmed' rather than through
 * the suggest-then-confirm flow (there's nothing to suggest — the user
 * already decided). `reason`, if given, is stored on each link's `note`
 * (surfaced by `reconNoteReasonLabel`); otherwise defaults to `RECON_NOTE_MANUAL`.
 * The pair keeps showing up correctly grouped by `keepId` on the
 * Reconciliation screen alongside anything the automatic matcher found.
 */
export async function markManualDuplicates(
  kind: "tax_income" | "tax_payment", keepId: number, excludeIds: number[], reason?: string,
): Promise<void> {
  await linkAndExclude(kind, [keepId], excludeIds, reason?.trim() ? reason.trim() : RECON_NOTE_MANUAL);
}

/**
 * User-initiated "these detail rows sum to that one aggregate row" mark —
 * e.g. AIS reports 4 quarterly interest entries while the bank statement/26AS
 * reports one annual total for the same account; counting both the detail
 * group AND the aggregate double-counts the same money, so exactly one side
 * should count. Unlike a plain duplicate, either side can be the survivor:
 * `keepIds`/`excludeIds` are caller-decided (Tax Detail's UI defaults to
 * keeping the aggregate and excluding the details, but offers the opposite
 * too — keeping the itemized breakdown and excluding the redundant total).
 * `reason`, if given, is stored on each link's `note`; otherwise defaults to
 * `RECON_NOTE_SUM_GROUP`.
 */
export async function markSumOfGroup(
  kind: "tax_income" | "tax_payment", keepIds: number[], excludeIds: number[], reason?: string,
): Promise<void> {
  await linkAndExclude(kind, keepIds, excludeIds, reason?.trim() ? reason.trim() : RECON_NOTE_SUM_GROUP);
}
