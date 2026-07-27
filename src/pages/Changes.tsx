import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney, formatMonthLabel } from "@/lib/format";
import { accountDeltasBetween, type AccountDelta } from "@/db/aggregates";
import { accountTypeKind } from "@/lib/accountTypes";

interface Row {
  account_id: number;
  name: string;
  currency: string;
  from: number | null;
  to: number | null;
  /** Signed change in net worth this account contributed (liabilities negated). */
  delta: number;
}

/**
 * Per-account breakdown of a dashboard "change" panel. Given a `from` and `to`
 * month, shows each account's value at both months and the signed delta it
 * contributed to net worth. The sum of the deltas equals the headline number on
 * the dashboard card that linked here (same signing, same per-month snapshots).
 */
export function ChangesPage() {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const label = params.get("label") ?? "Change";
  const currency = useSettingsStore((s) => s.settings.currency);

  const [deltas, setDeltas] = useState<AccountDelta[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isTauri() || !from || !to) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setDeltas(await accountDeltasBetween(from, to));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo<Row[]>(() => {
    return deltas
      .map((d) => {
        const sign = accountTypeKind(d.type) === "liability" ? -1 : 1;
        const delta = sign * (d.to_value ?? 0) - sign * (d.from_value ?? 0);
        return { account_id: d.account_id, name: d.name, currency: d.currency, from: d.from_value, to: d.to_value, delta };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [deltas]);

  const total = rows.reduce((a, r) => a + r.delta, 0);

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo="/"
        backLabel="Back to dashboard"
        title={label}
        description={
          from && to ? (
            <span className="flex items-center gap-1.5">
              {formatMonthLabel(from)} <ArrowRight className="h-3.5 w-3.5" /> {formatMonthLabel(to)}
            </span>
          ) : undefined
        }
      />

      {!isTauri() ? (
        <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app to see per-account changes.
          </CardContent>
        </Card>
      ) : !from || !to ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Open this page from a change panel on the dashboard.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl tabular-nums">
                {total >= 0 ? (
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-destructive" />
                )}
                <span className={total >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
                  {total >= 0 ? "+" : ""}{formatMoney(total, currency)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Net-worth change across {rows.length} account{rows.length === 1 ? "" : "s"}. Liabilities count
              against you. An account with a value in only one of the two months contributes its full value.
            </CardContent>
          </Card>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No account had a snapshot in either month.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {rows.map((r) => {
                    const positive = r.delta >= 0;
                    return (
                      <li key={r.account_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <Link to={`/accounts/${r.account_id}`} className="min-w-0 flex-1 hover:underline">
                          <span className="truncate font-medium">{r.name}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                            {r.from != null ? formatMoney(r.from, r.currency) : "—"} →{" "}
                            {r.to != null ? formatMoney(r.to, r.currency) : "—"}
                          </span>
                        </Link>
                        <span
                          className={`w-32 shrink-0 text-right font-medium tabular-nums ${
                            positive ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
                          }`}
                        >
                          {positive ? "+" : ""}{formatMoney(r.delta, r.currency)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
