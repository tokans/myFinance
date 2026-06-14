import { query, T } from "./client";
import { LIABILITY_TYPES, type AccountType } from "@/lib/accountTypes";

interface MonthTotal { month: string; total: number }

/**
 * Net worth per month: sum of non-archived account values, with liability-type
 * accounts (loans, credit cards) subtracted rather than added. Drives the
 * dashboard total/trend, FIRE current-net-worth prefill, and goal projections.
 */
export async function totalsByMonth(): Promise<Map<string, number>> {
  const placeholders = LIABILITY_TYPES.map(() => "?").join(", ");
  const rows = await query<MonthTotal>(
    `SELECT s.month AS month,
            SUM(CASE WHEN a.type IN (${placeholders}) THEN -s.value ELSE s.value END) AS total
       FROM ${T.monthlySnapshot} s
       JOIN ${T.accounts} a ON a.id = s.account_id
      WHERE a.is_archived = 0
      GROUP BY s.month
      ORDER BY s.month`,
    [...LIABILITY_TYPES],
  );
  return new Map(rows.map((r) => [r.month, r.total ?? 0]));
}

/**
 * Sum of the latest-month snapshot values for non-archived accounts of the given
 * types. Uses the same "latest month" (`MAX(month)`) as {@link totalsByMonth}, so
 * the result can be cleanly subtracted from that month's net worth — e.g. to
 * pull retirement vehicles (NPS/EPF/PPF) out of the FIRE drawdown corpus and
 * model them as guaranteed income instead. Returns 0 when there's no data.
 */
export async function balanceForTypesLatestMonth(types: AccountType[]): Promise<number> {
  if (types.length === 0) return 0;
  const placeholders = types.map(() => "?").join(", ");
  const rows = await query<{ total: number | null }>(
    `SELECT SUM(s.value) AS total
       FROM ${T.monthlySnapshot} s
       JOIN ${T.accounts} a ON a.id = s.account_id
      WHERE a.is_archived = 0
        AND a.type IN (${placeholders})
        AND s.month = (SELECT MAX(month) FROM ${T.monthlySnapshot})`,
    [...types],
  );
  return rows[0]?.total ?? 0;
}

interface LatestPerAccount {
  account_id: number;
  account_name: string;
  account_type: string;
  currency: string;
  month: string;
  value: number;
}

/** For each non-archived account, return its most recent snapshot. */
export async function latestSnapshotPerAccount(): Promise<LatestPerAccount[]> {
  return query<LatestPerAccount>(
    `SELECT a.id AS account_id, a.name AS account_name, a.type AS account_type,
            a.currency AS currency, s.month AS month, s.value AS value
       FROM ${T.accounts} a
       JOIN ${T.monthlySnapshot} s ON s.account_id = a.id
       JOIN (
         SELECT account_id, MAX(month) AS max_month
           FROM ${T.monthlySnapshot}
          GROUP BY account_id
       ) latest ON latest.account_id = s.account_id AND latest.max_month = s.month
      WHERE a.is_archived = 0
      ORDER BY value DESC`,
  );
}
