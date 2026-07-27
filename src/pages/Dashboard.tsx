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
import { ASSET_CATEGORIES, assetCategoryForType, type AssetCategory } from "@/lib/assetCategories";
import { useTierStore } from "@/stores/tier.store";
import { resolveTier, type TierContext } from "@/lib/gamification";
import { PageHeader } from "@/components/layout/PageHeader";

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
  is_family: number | null;
  family_relation: string | null;
}

// One asset category's rows + total, once grouped and zero-filtered.
interface CategoryGroup {
  value: AssetCategory;
  label: string;
  rows: AccountLatest[];
  total: number;
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

  // Split the latest-snapshot list into a Schedule-AL-style asset breakdown
  // (grouped by category, in ASSET_CATEGORIES' display order), liabilities, and
  // a family group. Display-only — the headline totalSavings already nets
  // liabilities out via totalsByMonth()'s SQL, so this grouping is just for the
  // per-account list. Zero-value ASSET rows are dropped (old/closed accounts
  // sitting at 0 add clutter, not signal); a category with no non-zero rows
  // isn't shown at all. tax_refund accounts are intentionally excluded from the
  // categorized list (assetCategoryForType returns null for it) but still count
  // toward the Total savings headline above, since that reads straight from the
  // DB. Accounts flagged `is_family` are pulled out of both the per-category
  // breakdown and the plain liabilities list into their own "Family" section,
  // regardless of type — so a family member's bank/loan/etc. account is always
  // listed separately from the user's own accounts of the same category.
  const breakdown = useMemo(() => {
    const family: AccountLatest[] = [];
    let familyTotal = 0;
    const liabilities: AccountLatest[] = [];
    let liabilityTotal = 0;
    const byCategory = new Map<AssetCategory, AccountLatest[]>();
    for (const a of perAccount) {
      const isLiability = accountTypeKind(a.account_type) === "liability";
      if (a.is_family) {
        if (!isLiability && a.value === 0) continue;
        family.push(a);
        familyTotal += isLiability ? -a.value : a.value;
        continue;
      }
      if (isLiability) {
        liabilities.push(a);
        liabilityTotal += a.value;
        continue;
      }
      if (a.value === 0) continue;
      const cat = assetCategoryForType(a.account_type);
      if (!cat) continue;
      const rows = byCategory.get(cat);
      if (rows) rows.push(a); else byCategory.set(cat, [a]);
    }
    const categories: CategoryGroup[] = ASSET_CATEGORIES.flatMap((c) => {
      const rows = byCategory.get(c.value);
      if (!rows || rows.length === 0) return [];
      return [{ value: c.value, label: c.label, rows, total: rows.reduce((s, a) => s + a.value, 0) }];
    });
    return { categories, liabilities, liabilityTotal, family, familyTotal };
  }, [perAccount]);

  return (
    <div className="container max-w-5xl py-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Dashboard <TierBadge ctx={tierCtx} />
          </span>
        }
        description={
          dashboard.latestMonth
            ? <>As of <strong>{formatMonthLabel(dashboard.latestMonth)}</strong>.</>
            : "Add an account and a monthly snapshot to start."
        }
        actions={
          <>
            <Suspense fallback={null}>
              <ExportButton />
            </Suspense>
            <Button asChild size="sm">
              <Link to={`/update?month=${currentMonth()}`}>
                Update {formatMonthLabel(currentMonth())} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </>
        }
      />

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
          linkTo={
            dashboard.mom && dashboard.latestMonth
              ? `/changes?from=${dashboard.mom.previousMonth}&to=${dashboard.latestMonth}&label=${encodeURIComponent("Change vs last month")}`
              : undefined
          }
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
          linkTo={
            dashboard.fyStart && dashboard.latestMonth
              ? `/changes?from=${dashboard.fyStart.startMonth}&to=${dashboard.latestMonth}&label=${encodeURIComponent("Change since FY start")}`
              : undefined
          }
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
            {dashboard.customStart && dashboard.latestMonth && (
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">
                  Anchored to {formatMonthLabel(dashboard.customStart.startMonth)} ({formatMoney(dashboard.customStart.startValue, currency)})
                </p>
                <p className={dashboard.customStart.delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
                  {dashboard.customStart.delta >= 0 ? "+" : ""}{formatMoney(dashboard.customStart.delta, currency)}
                </p>
                <Link
                  to={`/changes?from=${dashboard.customStart.startMonth}&to=${dashboard.latestMonth}&label=${encodeURIComponent(`Change since ${formatMonthLabel(dashboard.customStart.startMonth)}`)}`}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View by account <ArrowRight className="h-3 w-3" />
                </Link>
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
          ) : breakdown.categories.length === 0 && breakdown.liabilities.length === 0 && breakdown.family.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              No non-zero accounts yet — snapshots at ₹0 are hidden here.
            </p>
          ) : (
            <div className="divide-y">
              {breakdown.categories.map((cat) => (
                <div key={cat.value} className="divide-y">
                  <GroupHeader label={cat.label} total={cat.total} currency={currency} />
                  <AccountRows rows={cat.rows} />
                </div>
              ))}
              {breakdown.liabilities.length > 0 && (
                <div className="divide-y">
                  <GroupHeader label="Liabilities" total={-breakdown.liabilityTotal} currency={currency} negative />
                  <AccountRows rows={breakdown.liabilities} />
                </div>
              )}
              {breakdown.family.length > 0 && (
                <div className="divide-y">
                  <GroupHeader label="Family" total={breakdown.familyTotal} currency={currency} negative={breakdown.familyTotal < 0} />
                  <AccountRows rows={breakdown.family} />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DiffCard({
  label, delta, base, subtitle, currency, testId, linkTo,
}: {
  label: string;
  delta: number | null;
  base: number | null;
  subtitle: string;
  currency: string;
  testId?: string;
  /** When set (and there's a delta), the card links to the per-account breakdown. */
  linkTo?: string;
}) {
  const positive = delta != null && delta >= 0;
  const clickable = linkTo != null && delta != null;
  const inner = (
    <Card data-testid={testId} className={clickable ? "transition-colors hover:border-primary/50 hover:bg-muted/30" : undefined}>
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
        {clickable && (
          <span className="mt-1 flex items-center gap-1 text-primary">
            View by account <ArrowRight className="h-3 w-3" />
          </span>
        )}
      </CardContent>
    </Card>
  );
  return clickable ? (
    <Link to={linkTo!} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      {inner}
    </Link>
  ) : inner;
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

function AccountRows({ rows }: { rows: AccountLatest[] }) {
  return (
    <ul className="divide-y">
      {rows.map((a) => {
        const liability = accountTypeKind(a.account_type) === "liability";
        return (
          <li key={a.account_id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <Link to={`/accounts/${a.account_id}`} className="flex-1 min-w-0 truncate hover:underline">
              {a.account_name}
            </Link>
            {a.family_relation === "minor" && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Minor
              </span>
            )}
            <span className="text-xs text-muted-foreground">{formatMonthLabel(a.month)}</span>
            <span
              className={`w-32 text-right font-medium tabular-nums ${liability ? "text-destructive" : ""}`}
            >
              {formatMoney(a.value, a.currency)}
            </span>
          </li>
        );
      })}
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

