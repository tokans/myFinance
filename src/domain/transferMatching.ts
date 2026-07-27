/**
 * Cross-account self-transfer candidate detection: pairs an outgoing (debit)
 * transaction in one account with an incoming (credit) transaction in ANOTHER
 * account, within a date window and amount tolerance. Deliberately a simple
 * greedy highest-confidence-first assignment, not an optimal bipartite solver
 * (matches domain/calc.ts's "small, explainable, pure" style — no DB/React).
 *
 * Callers should only pass transactions with `match_status === "none"` —
 * a confirmed row already knows its match, and `match_status` is row-level
 * (not pair-level), so excluding "confirmed"/"dismissed" rows up front is
 * enough to keep a recompute from ever re-suggesting a rejected pair.
 */

export interface MatchableTransaction {
  id: number;
  accountId: number;
  /** 'YYYY-MM-DD'. */
  date: string;
  amount: number;
  direction: "debit" | "credit";
}

export interface TransferCandidate {
  outgoingId: number;
  incomingId: number;
  outgoingAccountId: number;
  incomingAccountId: number;
  dateDeltaDays: number;
  amountDelta: number;
  confidence: number;
}

export interface MatchOptions {
  /** Max days apart to consider a pair — covers NEFT/IMPS/next-business-day settlement. Default 3. */
  dateWindowDays?: number;
  /** Absolute amount slack (float/rounding). Default 1. */
  amountToleranceAbs?: number;
  /** Additional proportional slack on top of the absolute tolerance. Default 0 (self-transfers are normally exact). */
  amountTolerancePct?: number;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

export function findSelfTransferCandidates(
  transactions: MatchableTransaction[],
  opts: MatchOptions = {},
): TransferCandidate[] {
  const dateWindowDays = opts.dateWindowDays ?? 3;
  const amountToleranceAbs = opts.amountToleranceAbs ?? 1;
  const amountTolerancePct = opts.amountTolerancePct ?? 0;

  const debits = transactions.filter((t) => t.direction === "debit");
  const credits = transactions.filter((t) => t.direction === "credit");

  interface Scored {
    debit: MatchableTransaction;
    credit: MatchableTransaction;
    dateDeltaDays: number;
    amountDelta: number;
    confidence: number;
  }
  const scored: Scored[] = [];

  for (const d of debits) {
    for (const c of credits) {
      if (d.accountId === c.accountId) continue; // never pair within the same account
      const dateDeltaDays = daysBetween(d.date, c.date);
      if (dateDeltaDays > dateWindowDays) continue;
      const amountDelta = Math.abs(d.amount - c.amount);
      const tolerance = Math.max(amountToleranceAbs, d.amount * amountTolerancePct);
      if (amountDelta > tolerance) continue;
      const dateScore = dateWindowDays > 0 ? dateDeltaDays / dateWindowDays : 0;
      const amountScore = amountDelta / Math.max(d.amount, 1);
      const confidence = Math.max(0, 1 - dateScore * 0.3 - amountScore * 0.7);
      scored.push({ debit: d, credit: c, dateDeltaDays, amountDelta, confidence });
    }
  }

  // Highest-confidence pairs first, so a clean exact match wins over a looser one
  // when a transaction has more than one plausible counterpart.
  scored.sort((a, b) => b.confidence - a.confidence);

  const usedDebit = new Set<number>();
  const usedCredit = new Set<number>();
  const out: TransferCandidate[] = [];
  for (const s of scored) {
    if (usedDebit.has(s.debit.id) || usedCredit.has(s.credit.id)) continue;
    usedDebit.add(s.debit.id);
    usedCredit.add(s.credit.id);
    out.push({
      outgoingId: s.debit.id,
      incomingId: s.credit.id,
      outgoingAccountId: s.debit.accountId,
      incomingAccountId: s.credit.accountId,
      dateDeltaDays: s.dateDeltaDays,
      amountDelta: s.amountDelta,
      confidence: s.confidence,
    });
  }
  return out;
}
