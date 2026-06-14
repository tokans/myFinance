import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FileText, Upload, Sparkles, AlertCircle, Trash2, Globe, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isTauri } from "@/lib/environment";
import { useSettingsStore } from "@/stores/settings.store";
import { compactCurrency, formatMoney } from "@/lib/format";
import {
  clearAllTax, deleteTaxYear, getAssessment, listTaxYears,
  type TaxAssessment, type TaxYear,
} from "@/db/tax";
import { DangerZone } from "@/components/common/DangerZone";

const DEFAULT_AY = "2026-27";

export function TaxPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const residenceCountry = useSettingsStore((s) => s.settings.residenceCountry);
  const isNonIndia = !!residenceCountry && residenceCountry !== "IN";
  const [years, setYears] = useState<TaxYear[]>([]);
  const [assessments, setAssessments] = useState<Map<string, TaxAssessment>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const ys = await listTaxYears();
      setYears(ys);
      const m = new Map<string, TaxAssessment>();
      for (const y of ys) {
        const a = await getAssessment(y.ay);
        if (a) m.set(y.ay, a);
      }
      setAssessments(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (ay: string) => {
    if (!confirm(`Delete all tax records for AY ${ay}? This removes the year, income, deductions, payments and the assessment.`)) return;
    await deleteTaxYear(ay);
    await refresh();
  };

  // Year-over-year trend across assessment years that have a saved assessment.
  // `years` is sorted newest-first; the chart wants oldest → newest.
  const trend = useMemo(
    () =>
      years
        .map((y) => {
          const a = assessments.get(y.ay);
          return a
            ? {
                ay: `AY ${y.ay}`,
                gross: a.gross_total_income ?? 0,
                net: a.net_tax_liability ?? 0,
                paid: a.total_taxes_paid ?? 0,
              }
            : null;
        })
        .filter((d): d is { ay: string; gross: number; net: number; paid: number } => d != null)
        .reverse(),
    [years, assessments],
  );

  return (
    <div className="container max-w-4xl py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Income tax</h2>
          <p className="text-sm text-muted-foreground">
            Track annual income, deductions and TDS per assessment year. Import old ITR JSON or build from scratch.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" disabled={!isTauri()}>
            <Link to={`/tax/wizard?ay=${DEFAULT_AY}${isNonIndia ? "&nri=1" : ""}`}>
              <Sparkles className="h-4 w-4" /> {isNonIndia ? "Which NRI form?" : "Which ITR applies?"}
            </Link>
          </Button>
          {!isNonIndia && (
            <Button asChild disabled={!isTauri()}>
              <Link to="/tax/import">
                <Upload className="h-4 w-4" /> Import ITR JSON
              </Link>
            </Button>
          )}
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Tax records live in SQLite — start the desktop app to use this page.
          </CardContent>
        </Card>
      )}

      {isNonIndia ? (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="space-y-3 py-4 text-sm text-amber-900 dark:text-amber-200">
            <p className="flex items-center gap-2 font-medium">
              <Globe className="h-4 w-4" /> Income tax tracking is available for India only
            </p>
            <p className="text-xs">
              Your country of residence isn&apos;t set to India, so the full ITR module (forms, deductions,
              ITR JSON import) doesn&apos;t apply. If you are a Non-Resident Indian (NRI) with India-source income,
              you can still figure out which NRI form applies. Otherwise, update your country in Settings.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" disabled={!isTauri()}>
                <Link to={`/tax/wizard?ay=${DEFAULT_AY}&nri=1`}>
                  <Sparkles className="h-4 w-4" /> Find my NRI form
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings">
                  <SettingsIcon className="h-4 w-4" /> Update country in Settings
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4 border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
          <CardContent className="py-3 text-xs text-blue-900 dark:text-blue-200">
            <strong>Advisory only.</strong> The recommendation wizard and any extracted figures are informational,
            based on the AY 2026-27 schema published by the Income Tax Department. Verify with a Chartered
            Accountant before filing. This app does not file returns and does not transmit data anywhere.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {trend.length >= 2 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Trend</CardTitle>
            <CardDescription>Gross income, net tax and taxes paid by assessment year.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="ay" fontSize={11} />
                  <YAxis fontSize={11} width={64} tickFormatter={(v) => compactCurrency(v, currency)} />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v, currency)}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="gross" name="Gross income" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="net" name="Net tax" stroke="#dc2626" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="paid" name="Taxes paid" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : years.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No tax years yet</p>
            <p className="text-xs text-muted-foreground max-w-md">
              {isNonIndia
                ? "Run the wizard to find which NRI form applies, or update your country in Settings to enable full tax tracking."
                : "Import an existing ITR JSON to populate from your filed return, or run the wizard to figure out which form you need."}
            </p>
            <div className="flex gap-2 pt-1">
              {!isNonIndia && (
                <Button asChild size="sm"><Link to="/tax/import"><Upload className="h-4 w-4" /> Import ITR</Link></Button>
              )}
              <Button asChild size="sm" variant="outline"><Link to={`/tax/wizard?ay=${DEFAULT_AY}${isNonIndia ? "&nri=1" : ""}`}><Sparkles className="h-4 w-4" /> Run wizard</Link></Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {years.map((y) => {
            const a = assessments.get(y.ay);
            return (
              <li key={y.ay}>
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <h3 className="text-lg font-semibold">AY {y.ay}</h3>
                      {y.itr_form && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                          ITR-{y.itr_form}
                        </span>
                      )}
                      {y.itr_form_source && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          via {y.itr_form_source}
                        </span>
                      )}
                      {y.imported_filename && (
                        <span className="text-xs text-muted-foreground truncate">{y.imported_filename}</span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/tax/${encodeURIComponent(y.ay)}`}>Open</Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(y.ay)} aria-label="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {a ? (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                        <Stat label="Gross total" value={a.gross_total_income} currency={currency} />
                        <Stat label="Total income" value={a.total_income} currency={currency} />
                        <Stat label="Net tax" value={a.net_tax_liability} currency={currency} />
                        <Stat label="Refund / due" value={a.refund_or_balance} currency={currency} />
                      </dl>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5" /> No assessment summary yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <DangerZone
        onCleared={refresh}
        actions={[
          {
            id: "tax",
            label: "Clear tax records",
            description: (
              <>
                <span className="font-medium text-foreground">Clear tax records</span> — deletes all{" "}
                {years.length} assessment year{years.length === 1 ? "" : "s"} and their income,
                deductions, payments and assessments. This cannot be undone.
              </>
            ),
            confirmPrompt: "Delete every tax record?",
            confirmLabel: "Yes, delete records",
            count: years.length,
            run: clearAllTax,
          },
        ]}
      />
    </div>
  );
}

function Stat({ label, value, currency }: { label: string; value: number | null; currency: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value != null ? formatMoney(value, currency) : "—"}</dd>
    </div>
  );
}
