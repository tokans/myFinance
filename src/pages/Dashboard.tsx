import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { currentMonth, formatMoney, formatMonthLabel } from "@/lib/format";
import { latestSnapshotPerAccount, totalsByMonth } from "@/db/aggregates";
import { carryForwardSeries, computeDashboard } from "@/domain/calc";
import { accountTypeKind } from "@/lib/accountTypes";
import { useTierStore } from "@/stores/tier.store";
import { resolveTier, type TierContext } from "@/lib/gamification";

// Heavy widgets are code-split so the index route paints without recharts/xlsx
// on the critical path. TrendChart pulls in recharts; ExportButton pulls in
// xlsx (via src/excel/export). Both render behind a <Suspense> below.
const TrendChart = lazy(() => import("@/components/dashboard/TrendChart"));
const ExportButton = lazy(() =>
  import("@/components/dashboard/ExportButton").then((m) => ({ default: m.ExportButton })),
);

interface AccountLatest {
  account_id: number;
  account_name: string;
  account_type: string;
  currency: string;
  month: string;
  value: number;
}

export function DashboardPage() {
  const { currency, fyStartMonth } = useSettingsStore((s) => s.settings);
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [perAccount, setPerAccount] = useState<AccountLatest[]>([]);
  const [loading, setLoading] = useState(true);
  const [customStart, setCustomStart] = useState<string>("");
  const tierCtx = useTierStore((s) => s.ctx);
  const refreshTier = useTierStore((s) => s.refresh);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [t, p] = await Promise.all([
        totalsByMonth(),
        latestSnapshotPerAccount(),
      ]);
      setTotals(t);
      setPerAccount(p);
      void refreshTier();
    } finally {
      setLoading(false);
    }
  }, [refreshTier]);

  useEffect(() => { void refresh(); }, [refresh]);

  const dashboard = useMemo(
    () => computeDashboard(totals, fyStartMonth, customStart || undefined),
    [totals, fyStartMonth, customStart],
  );
  const series = useMemo(() => carryForwardSeries(totals), [totals]);

  // Split the latest-snapshot list into assets vs liabilities for the breakdown.
  // Display-only — the headline totalSavings already nets liabilities out via
  // totalsByMonth()'s SQL, so this split is just for the per-account grouping.
  const breakdown = useMemo(() => {
    const assets: AccountLatest[] = [];
    const liabilities: AccountLatest[] = [];
    let assetTotal = 0;
    let liabilityTotal = 0;
    for (const a of perAccount) {
      if (accountTypeKind(a.account_type) === "liability") {
        liabilities.push(a);
        liabilityTotal += a.value;
      } else {
        assets.push(a);
        assetTotal += a.value;
      }
    }
    return { assets, liabilities, assetTotal, liabilityTotal };
  }, [perAccount]);

  return (
    <div className="container max-w-5xl py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
            <TierBadge ctx={tierCtx} />
          </div>
          <p className="text-sm text-muted-foreground">
            {dashboard.latestMonth
              ? <>As of <strong>{formatMonthLabel(dashboard.latestMonth)}</strong>.</>
              : "Add an account and a monthly snapshot to start."}
          </p>
        </div>
        <div className="flex gap-2">
          <Suspense fallback={null}>
            <ExportButton />
          </Suspense>
          <Button asChild size="sm">
            <Link to={`/update?month=${currentMonth()}`}>
              Update {formatMonthLabel(currentMonth())} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Browser mode — no DB. Run in the desktop app to see your numbers.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card data-testid="dashboard-total-savings">
          <CardHeader>
            <CardDescription>Total savings</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {loading ? "—" : formatMoney(dashboard.totalSavings, currency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {dashboard.latestMonth ? formatMonthLabel(dashboard.latestMonth) : "no data"}
          </CardContent>
        </Card>

        <DiffCard
          testId="dashboard-mom-delta"
          label="Change vs last month"
          delta={dashboard.mom?.delta ?? null}
          base={dashboard.mom?.previousValue ?? null}
          subtitle={dashboard.mom ? `vs ${formatMonthLabel(dashboard.mom.previousMonth)}` : "no prior month"}
          currency={currency}
        />

        <DiffCard
          testId="dashboard-fy-delta"
          label="Change since FY start"
          delta={dashboard.fyStart?.delta ?? null}
          base={dashboard.fyStart?.startValue ?? null}
          subtitle={
            dashboard.fyStart
              ? `since ${formatMonthLabel(dashboard.fyStart.startMonth)}`
              : `FY starts ${fyStartMonth === 1 ? "Jan" : "Apr"}`
          }
          currency={currency}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Trend</CardTitle>
          <CardDescription>Total savings, month over month (carry-forward).</CardDescription>
        </CardHeader>
        <CardContent>
          {series.length === 0 ? (
            <p className="text-xs text-muted-foreground">No data yet.</p>
          ) : (
            <Suspense fallback={<div className="h-64" />}>
              <TrendChart series={series} currency={currency} />
            </Suspense>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Compare from a specific month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="cstart" className="text-xs">Anchor month</Label>
              <Input
                id="cstart"
                type="month"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </div>
            {dashboard.customStart && (
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">
                  Anchored to {formatMonthLabel(dashboard.customStart.startMonth)} ({formatMoney(dashboard.customStart.startValue, currency)})
                </p>
                <p className={dashboard.customStart.delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
                  {dashboard.customStart.delta >= 0 ? "+" : ""}{formatMoney(dashboard.customStart.delta, currency)}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">By account</CardTitle>
          <CardDescription>Each account's most recent snapshot.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {perAccount.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">No snapshots yet.</p>
          ) : breakdown.liabilities.length === 0 ? (
            <AccountRows rows={breakdown.assets} />
          ) : (
            <div className="divide-y">
              <GroupHeader label="Assets" total={breakdown.assetTotal} currency={currency} />
              <AccountRows rows={breakdown.assets} />
              <GroupHeader label="Liabilities" total={-breakdown.liabilityTotal} currency={currency} negative />
              <AccountRows rows={breakdown.liabilities} liability />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DiffCard({
  label, delta, base, subtitle, currency, testId,
}: {
  label: string;
  delta: number | null;
  base: number | null;
  subtitle: string;
  currency: string;
  testId?: string;
}) {
  const positive = delta != null && delta >= 0;
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-2xl tabular-nums">
          {delta == null ? (
            "—"
          ) : (
            <>
              {positive ? <TrendingUp className="h-5 w-5 text-emerald-600" /> : <TrendingDown className="h-5 w-5 text-destructive" />}
              <span className={positive ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
                {positive ? "+" : ""}{formatMoney(delta, currency)}
              </span>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {subtitle}
        {base != null && base !== 0 && delta != null && (
          <span className="ml-1">({((delta / Math.abs(base)) * 100).toFixed(1)}%)</span>
        )}
      </CardContent>
    </Card>
  );
}

function GroupHeader({
  label, total, currency, negative,
}: { label: string; total: number; currency: string; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between bg-muted/40 px-4 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium tabular-nums ${negative ? "text-destructive" : "text-muted-foreground"}`}>
        {formatMoney(total, currency)}
      </span>
    </div>
  );
}

function AccountRows({ rows, liability }: { rows: AccountLatest[]; liability?: boolean }) {
  return (
    <ul className="divide-y">
      {rows.map((a) => (
        <li key={a.account_id} className="flex items-center gap-3 px-4 py-2 text-sm">
          <Link to={`/accounts/${a.account_id}`} className="flex-1 min-w-0 hover:underline">
            {a.account_name}
          </Link>
          <span className="text-xs text-muted-foreground">{formatMonthLabel(a.month)}</span>
          <span
            className={`w-32 text-right font-medium tabular-nums ${liability ? "text-destructive" : ""}`}
          >
            {formatMoney(a.value, a.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Small engagement-tier chip shown beside the Dashboard title. */
function TierBadge({ ctx }: { ctx: TierContext }) {
  const tier = resolveTier(ctx);
  const Icon = tier.icon;
  return (
    <span
      title={tier.criteria}
      className={`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium ${tier.className}`}
    >
      <Icon className="h-3.5 w-3.5" /> {tier.label}
    </span>
  );
}

