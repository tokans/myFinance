/**
 * Pure nominee/beneficiary analytics (Feature 2). No DB/React. Tested in
 * nominations.test.ts.
 */

export type HoldingRole = "nominee" | "co_holder" | "beneficiary";

export interface HoldingLike {
  account_id: number;
  person_id: number;
  role: HoldingRole | string;
  share_pct?: number | null;
  created_at?: string;
}

/** Stale-nominee threshold in years (spec: review after > 3 years). */
export const STALE_NOMINEE_YEARS = 3;

/** Sum of nominee share percentages for one account. */
export function nomineeShareSum(holdings: HoldingLike[], accountId: number): number {
  return holdings
    .filter((h) => h.account_id === accountId && h.role === "nominee")
    .reduce((s, h) => s + (Number(h.share_pct) || 0), 0);
}

/**
 * Whether an account's nominee shares are valid: either no nominees at all, or
 * they sum to (approximately) 100%. A small epsilon tolerates float noise.
 */
export function nomineeSharesValid(holdings: HoldingLike[], accountId: number): boolean {
  const nominees = holdings.filter((h) => h.account_id === accountId && h.role === "nominee");
  if (nominees.length === 0) return true;
  const sum = nomineeShareSum(holdings, accountId);
  return Math.abs(sum - 100) < 0.01;
}

/** Account ids that have no nominee holding — the red-flag list. */
export function accountIdsWithoutNominee(accountIds: number[], holdings: HoldingLike[]): number[] {
  const withNominee = new Set(
    holdings.filter((h) => h.role === "nominee").map((h) => h.account_id),
  );
  return accountIds.filter((id) => !withNominee.has(id));
}

export interface ValuedAccount {
  id: number;
  value: number;
}

export interface PersonExposure {
  person_id: number;
  /** Sum over accounts of (account value × nominee share%). */
  total: number;
  accountCount: number;
}

/**
 * Total nominee exposure per person: for each nominee holding, the person is
 * credited their share of the account's value. Lets the user see how much sits
 * with each beneficiary.
 */
export function exposureByPerson(
  accounts: ValuedAccount[],
  holdings: HoldingLike[],
): PersonExposure[] {
  const valueById = new Map(accounts.map((a) => [a.id, a.value]));
  const byPerson = new Map<number, { total: number; accounts: Set<number> }>();
  for (const h of holdings) {
    if (h.role !== "nominee") continue;
    const value = valueById.get(h.account_id);
    if (value == null) continue;
    const share = (Number(h.share_pct) || 0) / 100;
    const entry = byPerson.get(h.person_id) ?? { total: 0, accounts: new Set<number>() };
    entry.total += value * share;
    entry.accounts.add(h.account_id);
    byPerson.set(h.person_id, entry);
  }
  return [...byPerson.entries()]
    .map(([person_id, e]) => ({ person_id, total: e.total, accountCount: e.accounts.size }))
    .sort((a, b) => b.total - a.total);
}

/** A nominee record is stale when created more than STALE_NOMINEE_YEARS ago. */
export function isStaleNominee(createdAt: string | undefined, today: string): boolean {
  if (!createdAt) return false;
  const created = createdAt.slice(0, 10);
  const [cy, cm, cd] = created.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (!cy || !ty) return false;
  let years = ty - cy;
  if (tm < cm || (tm === cm && td < cd)) years -= 1;
  return years >= STALE_NOMINEE_YEARS;
}
