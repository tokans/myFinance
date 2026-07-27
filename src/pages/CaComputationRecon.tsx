import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Github, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReportIssueDialog } from "@/components/feedback/ReportIssueDialog";
import { isTauri } from "@/lib/environment";
import { suggestKeyword } from "@/lib/keywordCategoryMatcher";
import { formatMoney } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { getAssessment, listDeductions, listIncome, listPayments } from "@/db/tax";
import { listForAy } from "@/db/taxCaComputation";
import {
  ALL_FIXED_CATEGORIES, labelForSystemCategory, learnCaLabel, loadLearnedCaLabelRules,
  reconcileCaComputation, type CaReconResult, type LearnedCaLabelRule, type SystemTaxCategory,
} from "@/tax/caReconciliation";

const SKIP = "__skip__" as const;
type Choice = SystemTaxCategory | typeof SKIP;

/**
 * Reconciles the CA computation sheet imported for this AY (`/tax/ca-computation`)
 * against this app's own tax-year data — a category-presence check, not a
 * figure-matching one (see `tax/caReconciliation.ts`'s doc comment). Nothing
 * here changes a saved tax figure; it's a read-only cross-check, promoted
 * from `ReconciliationPage` the same way that page promotes SFT cross-check
 * to its own page.
 */
export function CaComputationReconPage() {
  const { ay = "" } = useParams<{ ay: string }>();
  const currency = useSettingsStore((s) => s.settings.currency);
  const [caLines, setCaLines] = useState<{ label: string; amount: number }[]>([]);
  const [system, setSystem] = useState<Parameters<typeof reconcileCaComputation>[1] | null>(null);
  const [learnedRules, setLearnedRules] = useState<LearnedCaLabelRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolutions, setResolutions] = useState<Record<string, Choice>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [keywordText, setKeywordText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    const [ca, income, deductions, payments, assessment, learned] = await Promise.all([
      listForAy(ay),
      listIncome(ay),
      listDeductions(ay),
      listPayments(ay),
      getAssessment(ay),
      loadLearnedCaLabelRules(),
    ]);
    setCaLines(ca.map((r) => ({ label: r.label, amount: r.amount })));
    setSystem({
      income: income.map((r) => ({ head: r.head, amount: r.amount })),
      deductions: deductions.map((r) => ({ section: r.section, amount: r.amount })),
      payments: payments.map((r) => ({ type: r.type, amount: r.amount })),
      assessment,
    });
    setLearnedRules(learned);
    setResolutions({});
    setLoading(false);
  }, [ay]);

  useEffect(() => { void refresh(); }, [refresh]);

  const effectiveCaLines = caLines.filter((l) => resolutions[l.label] !== SKIP);
  const sessionOverrides: LearnedCaLabelRule[] = Object.entries(resolutions)
    .filter((e): e is [string, SystemTaxCategory] => e[1] !== SKIP)
    .map(([caLabel, category]) => ({ keyword: caLabel, category }));

  const result: CaReconResult | null = system
    ? reconcileCaComputation(effectiveCaLines, system, [...learnedRules, ...sessionOverrides])
    : null;

  const chooseFor = (caLabel: string, choice: Choice) => {
    setResolutions((r) => ({ ...r, [caLabel]: choice }));
    if (!keywordText[caLabel]) setKeywordText((k) => ({ ...k, [caLabel]: suggestKeyword(caLabel) }));
  };

  const saveClarifications = async () => {
    setSaving(true);
    try {
      for (const [caLabel, choice] of Object.entries(resolutions)) {
        if (choice === SKIP || !remember[caLabel]) continue;
        const text = keywordText[caLabel]?.trim();
        if (!text) continue;
        await learnCaLabel(text, choice);
      }
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const issueDescription = result
    ? buildGapReportText(ay, result)
    : "";

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <PageHeader backTo={`/tax/${encodeURIComponent(ay)}`} backLabel="Back to tax year" title="CA computation check" />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Tax records live in SQLite — start the desktop app to use this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !result) {
    return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo={`/tax/${encodeURIComponent(ay)}`}
        backLabel="Back to tax year"
        title="CA computation check"
        description="Compares your Chartered Accountant's tax computation sheet against this app's own records for this AY — nothing here changes a saved figure."
      />

      {caLines.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium">No CA computation sheet imported for AY {ay} yet</p>
            <Button asChild size="sm">
              <Link to="/tax/ca-computation"><Upload className="h-4 w-4" /> Import CA Tax Calculation</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Matched ({result.matched.length})</h3>
            {result.matched.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing matched yet.</p>
            ) : (
              <div className="space-y-2">
                {result.matched.map((m, i) => (
                  <Card key={i}>
                    <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">{m.caLabel}</p>
                        <p className="text-xs text-muted-foreground">↔ {m.systemLabel}</p>
                      </div>
                      <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {formatMoney(m.caAmount, currency)} / {formatMoney(m.systemAmount, currency)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Missing in this app ({result.missingInSystem.length})</h3>
            <p className="text-xs text-muted-foreground">Your CA's document has these — this app has no records for them for AY {ay}.</p>
            {result.missingInSystem.length === 0 ? (
              <p className="text-xs text-muted-foreground">None.</p>
            ) : (
              <div className="space-y-2">
                {result.missingInSystem.map((g, i) => (
                  <Card key={i} className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
                    <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span>{g.label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMoney(g.caAmount, currency)}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Missing in your CA's document ({result.missingInCaDoc.length})</h3>
            <p className="text-xs text-muted-foreground">This app has these for AY {ay} — your CA's document doesn't show them.</p>
            {result.missingInCaDoc.length === 0 ? (
              <p className="text-xs text-muted-foreground">None.</p>
            ) : (
              <div className="space-y-2">
                {result.missingInCaDoc.map((g, i) => (
                  <Card key={i} className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
                    <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span>{g.label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMoney(g.systemAmount, currency)}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {result.unclassified.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Needs clarification ({result.unclassified.length})</h3>
              <p className="text-xs text-muted-foreground">
                Couldn't tell what these line items correspond to — pick a category (or "No equivalent").
              </p>
              <div className="space-y-3">
                {result.unclassified.map((u) => (
                  <Card key={u.caLabel}>
                    <CardContent className="space-y-2 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{u.caLabel}</p>
                          {u.candidates.length > 0 && (
                            <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              Ambiguous — matches {u.candidates.map((c) => labelForSystemCategory(c)).join(", ")}
                            </p>
                          )}
                        </div>
                        <Select value={resolutions[u.caLabel] ?? undefined} onValueChange={(v) => chooseFor(u.caLabel, v as Choice)}>
                          <SelectTrigger className="w-64">
                            <SelectValue placeholder="Choose a category…" />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_FIXED_CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>{labelForSystemCategory(c)}</SelectItem>
                            ))}
                            <SelectItem value={SKIP}>No equivalent / skip</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {resolutions[u.caLabel] && resolutions[u.caLabel] !== SKIP && (
                        <label className="flex items-start gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={!!remember[u.caLabel]}
                            onChange={(e) => setRemember((r) => ({ ...r, [u.caLabel]: e.target.checked }))}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-input accent-primary"
                          />
                          <span className="flex flex-wrap items-center gap-1">
                            Remember{" "}
                            <Input
                              value={keywordText[u.caLabel] ?? ""}
                              onChange={(e) => setKeywordText((k) => ({ ...k, [u.caLabel]: e.target.value }))}
                              className="h-6 w-40 px-1.5 py-0.5 text-xs"
                              placeholder="keyword"
                            />
                            {" "}→ this category for future CA documents?
                          </span>
                        </label>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={saveClarifications} disabled={saving}>
                  {saving ? "Saving…" : "Save clarifications"}
                </Button>
              </div>
            </section>
          )}

          {(result.missingInSystem.length > 0 || result.missingInCaDoc.length > 0) && (
            <Card className="border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-xs text-blue-900 dark:text-blue-200">
                  See a gap worth flagging? The report only lists category names — never amounts.
                </span>
                <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
                  <Github className="h-4 w-4" /> Report gaps to GitHub
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <ReportIssueDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        initialType="question"
        initialTitle={`CA computation reconciliation gap — AY ${ay}`}
        initialDescription={issueDescription}
      />
    </div>
  );
}

/** Builds the GitHub issue draft text — category NAMES only, deliberately
 *  never the CA's or this app's actual figures (this leaves the device as a
 *  public GitHub issue; amounts stay local). The dialog's own editable
 *  textarea is the final check before anything is sent. */
function buildGapReportText(ay: string, result: CaReconResult): string {
  const lines: string[] = [
    `reconciling against my CA's tax computation for AY ${ay} turned up category differences (no figures included):`,
  ];
  if (result.missingInSystem.length > 0) {
    lines.push("", "Categories my CA's document has that this app doesn't capture:");
    for (const g of result.missingInSystem) lines.push(`- ${g.label} (${g.kind})`);
  }
  if (result.missingInCaDoc.length > 0) {
    lines.push("", "Categories this app has that my CA's document doesn't show:");
    for (const g of result.missingInCaDoc) lines.push(`- ${g.label} (${g.kind})`);
  }
  return lines.join("\n");
}
