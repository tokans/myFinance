import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Sparkles, Upload, FileDown, RefreshCw, AlertCircle, GitMerge, CheckCircle2, AlertTriangle,
  ArrowUp, ArrowDown, ArrowUpDown, Filter, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isTauri } from "@/lib/environment";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useSettingsStore } from "@/stores/settings.store";
import { formatMoney } from "@/lib/format";
import {
  clearRowsBySourcePrefix, getAssessment, getTaxYear, insertIncome, listDeductions,
  listIncome, listIncomeAll, listPayments, listPaymentsAll, moveIncomeToPayment, movePaymentToIncome,
  type IncomeHead, type PaymentType, type TaxAssessment, type TaxDeductionRow, type TaxIncomeRow,
  type TaxPaymentRow, type TaxYear,
} from "@/db/tax";
import { listAllTransactions } from "@/db/transactions";
import { listAllTags } from "@/db/transactionTags";
import { ayToFyRange, buildLedgerTaxSync, LEDGER_SOURCE_PREFIX, type LedgerTaxSyncResult } from "@/tax/ledgerTaxSync";
import { HEAD_LABELS, PAYMENT_LABELS, paymentRowLabel } from "@/tax/taxLabels";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  runAutoRecon, listAllLinks, markManualDuplicates, markSumOfGroup,
  type AutoReconResult, type ReconLinkRow,
} from "@/db/reconLinks";
import { documentLabelForSource, reconNoteReasonLabel, RECON_NOTE_DISCREPANCY } from "@/domain/recon";

/** Dropdown vocabularies for `ReconRowTable`'s "Move" mode — the target category the
 *  user picks when reclassifying a row the parser put in the wrong table. */
const INCOME_HEAD_OPTIONS = Object.entries(HEAD_LABELS).map(([value, label]) => ({ value, label }));
const PAYMENT_TYPE_OPTIONS = Object.entries(PAYMENT_LABELS).map(([value, label]) => ({ value, label }));

/** What to badge a surviving income/payment row with, derived from this AY's
 *  recon links: either it absorbed one or more confirmed duplicates
 *  (`reconciledFrom`, one entry per excluded row + why — exact match,
 *  standard deduction, or the user's own typed reason), or it's still
 *  visible alongside a close-but-not-quite match from another document
 *  (`discrepancy`) that needs a human call. A row can't be both — once
 *  confirmed either way, only the winner remains visible. */
interface ReconBadgeInfo {
  reconciledFrom?: { label: string; reason: string }[];
  discrepancy?: { ownLabel: string | null; otherLabel: string | null; otherAmount: number; delta: number };
}

/** Builds a per-row badge map for one recon-able table (`tax_income` or
 *  `tax_payment`) from its full row set (including excluded losers, so a
 *  confirmed pair's loser is resolvable) and every recon link. Generic over
 *  `TaxIncomeRow`/`TaxPaymentRow` — both share the fields this needs. */
function buildReconBadges<T extends { id: number; amount: number; source_path: string | null; excluded?: boolean }>(
  rows: T[], links: ReconLinkRow[], kind: "tax_income" | "tax_payment",
): Map<number, ReconBadgeInfo> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<number, ReconBadgeInfo>();
  for (const l of links) {
    if (l.a_kind !== kind || l.b_kind !== kind) continue;
    const a = byId.get(l.a_id);
    const b = byId.get(l.b_id);
    if (!a || !b) continue;
    if (l.status === "confirmed") {
      // Whichever side isn't excluded is the winner — true regardless of a/b position or
      // which tier's exclusion rule fired (fixed b-side vs. amount-aware, see `confirmLink`).
      const winner = a.excluded ? b : a;
      const loser = a.excluded ? a : b;
      const loserLabel = documentLabelForSource(loser.source_path);
      if (!loserLabel) continue;
      const existing = out.get(winner.id)?.reconciledFrom ?? [];
      out.set(winner.id, { reconciledFrom: [...existing, { label: loserLabel, reason: reconNoteReasonLabel(l.note) }] });
    } else if (l.status === "suggested" && l.note === RECON_NOTE_DISCREPANCY) {
      const delta = Math.abs(a.amount - b.amount);
      const aLabel = documentLabelForSource(a.source_path);
      const bLabel = documentLabelForSource(b.source_path);
      out.set(a.id, { discrepancy: { ownLabel: aLabel, otherLabel: bLabel, otherAmount: b.amount, delta } });
      out.set(b.id, { discrepancy: { ownLabel: bLabel, otherLabel: aLabel, otherAmount: a.amount, delta } });
    }
  }
  return out;
}

/** Source column text for one row: its own document plus, once reconciled, every
 *  source it absorbed (`badgeInfo.reconciledFrom`) — e.g. a salary row Form 16 and
 *  AIS both reported shows "Form 16, AIS (PDF)" once the duplicate is confirmed. */
function combinedSourceText(sourcePath: string | null, badgeInfo: ReconBadgeInfo | undefined): string {
  const own = documentLabelForSource(sourcePath);
  const absorbed = badgeInfo?.reconciledFrom?.map((r) => r.label) ?? [];
  const all = [...new Set([own, ...absorbed].filter((s): s is string => s != null))];
  return all.length > 0 ? all.join(", ") : "—";
}

export function TaxDetailPage() {
  const { ay = "" } = useParams();
  const currency = useSettingsStore((s) => s.settings.currency);
  const isDesktop = useIsDesktop();
  const [year, setYear] = useState<TaxYear | null>(null);
  const [income, setIncome] = useState<TaxIncomeRow[]>([]);
  const [deductions, setDeductions] = useState<TaxDeductionRow[]>([]);
  const [payments, setPayments] = useState<TaxPaymentRow[]>([]);
  const [incomeBadges, setIncomeBadges] = useState<Map<number, ReconBadgeInfo>>(new Map());
  const [paymentBadges, setPaymentBadges] = useState<Map<number, ReconBadgeInfo>>(new Map());
  const [assessment, setAssessment] = useState<TaxAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<LedgerTaxSyncResult | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicateCheckResult, setDuplicateCheckResult] = useState<AutoReconResult | null>(null);

  const refresh = useCallback(async (): Promise<AutoReconResult> => {
    if (!isTauri()) { setLoading(false); return { autoConfirmed: 0, standardDeductionMapped: 0, discrepancies: 0 }; }
    setLoading(true);
    try {
      // Auto-reconcile exact-amount cross-document duplicates before reading totals, so
      // this screen never shows a double-counted figure the user hasn't had a chance to see —
      // re-run on every load so records imported before this logic (or a matcher fix) existed
      // still get checked, not just newly-imported ones.
      const recon = await runAutoRecon(ay);
      const [y, i, iAll, d, p, pAll, a, links] = await Promise.all([
        getTaxYear(ay),
        listIncome(ay),
        listIncomeAll(ay),
        listDeductions(ay),
        listPayments(ay),
        listPaymentsAll(ay),
        getAssessment(ay),
        listAllLinks(),
      ]);
      setYear(y); setIncome(i); setDeductions(d); setPayments(p); setAssessment(a);
      setIncomeBadges(buildReconBadges(iAll, links, "tax_income"));
      setPaymentBadges(buildReconBadges(pAll, links, "tax_payment"));
      return recon;
    } finally {
      setLoading(false);
    }
  }, [ay]);

  const checkForDuplicates = async () => {
    setCheckingDuplicates(true);
    try {
      setDuplicateCheckResult(await refresh());
    } finally {
      setCheckingDuplicates(false);
    }
  };

  /** Row-selection override for when the automatic matcher (`domain/recon.ts`)
   *  still doesn't flag two rows the user can see share the same amount —
   *  see `ReconRowTable`'s selection UI. */
  const markDuplicate = async (
    kind: "tax_income" | "tax_payment", keepId: number, excludeIds: number[], reason: string,
  ) => {
    await markManualDuplicates(kind, keepId, excludeIds, reason);
    await refresh();
  };

  /** Row-selection override for "these N rows sum to that one row" — e.g. AIS's 4
   *  quarterly interest entries vs. one annual total elsewhere. See `ReconRowTable`. */
  const markSum = async (
    kind: "tax_income" | "tax_payment", keepIds: number[], excludeIds: number[], reason: string,
  ) => {
    await markSumOfGroup(kind, keepIds, excludeIds, reason);
    await refresh();
  };

  /** Reclassifies rows the parser put in the wrong table — a document's category
   *  text/layout can plausibly read as either an income line or a payment (a TDS
   *  credit under "other_sources", an advance-tax challan under a payment type when
   *  it's really informational income). See `ReconRowTable`'s "Move" mode. */
  const moveToPayments = async (ids: number[], type: PaymentType) => {
    for (const id of ids) await moveIncomeToPayment(id, type);
    await refresh();
  };
  const moveToIncome = async (ids: number[], head: IncomeHead) => {
    for (const id of ids) await movePaymentToIncome(id, head);
    await refresh();
  };

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshFromLedger = async () => {
    const range = ayToFyRange(ay);
    if (!range) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const [transactions, tags] = await Promise.all([
        listAllTransactions({ fromDate: range.from, toDate: range.to }),
        listAllTags(),
      ]);
      const categoriesByTxn = new Map<number, string[]>();
      for (const t of tags) {
        const list = categoriesByTxn.get(t.transaction_id);
        if (list) list.push(t.category);
        else categoriesByTxn.set(t.transaction_id, [t.category]);
      }
      const result = buildLedgerTaxSync(
        transactions.map((t) => ({ description: t.description, credit: t.credit, categories: categoriesByTxn.get(t.id) ?? [] })),
        ay,
      );
      await clearRowsBySourcePrefix(ay, LEDGER_SOURCE_PREFIX);
      for (const r of result.incomeRows) await insertIncome(r);
      setRefreshResult(result);
      await refresh();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <PageHeader backTo="/tax" backLabel="Back to tax" title={`AY ${ay}`} />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;

  if (!year) {
    return (
      <div className="container max-w-3xl py-6">
        <Link to="/tax" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to tax
        </Link>
        <Card className="mt-4">
          <CardContent className="space-y-3 py-6 text-center">
            <p>No data for AY {ay} yet.</p>
            <div className="flex justify-center gap-2">
              <Button asChild size="sm"><Link to="/tax/import"><Upload className="h-4 w-4" /> Import ITR</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to={`/tax/wizard?ay=${ay}`}><Sparkles className="h-4 w-4" /> Run wizard</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalIncome = income.reduce((a, r) => a + r.amount, 0);
  const totalDeductions = deductions.reduce((a, r) => a + r.amount, 0);
  const totalPayments = payments.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo="/tax"
        backLabel="Back to tax"
        title={
          <span className="inline-flex items-center gap-2">
            AY {year.ay}
            {year.itr_form && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                ITR-{year.itr_form}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {isDesktop && (
              <Button size="sm" variant="outline" onClick={refreshFromLedger} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing…" : "Refresh from transactions"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void checkForDuplicates()} disabled={checkingDuplicates}>
              <CheckCircle2 className={`h-4 w-4 ${checkingDuplicates ? "animate-spin" : ""}`} />
              {checkingDuplicates ? "Checking…" : "Check for duplicates"}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/tax/${encodeURIComponent(year.ay)}/recon`}>
                <GitMerge className="h-4 w-4" /> Reconciliation
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/tax/wizard?ay=${encodeURIComponent(year.ay)}`}>
                <Sparkles className="h-4 w-4" /> Recheck form
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to={`/tax/${encodeURIComponent(year.ay)}/return`}>
                <FileDown className="h-4 w-4" /> Prepare return
              </Link>
            </Button>
          </>
        }
      />

      {refreshError && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{refreshError}</CardContent>
        </Card>
      )}

      {refreshResult && (
        <Card className="mb-4 border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
          <CardContent className="py-3 text-xs text-blue-900 dark:text-blue-200">
            Refreshed from {refreshResult.transactionCount} bank transaction(s): dividend{" "}
            {formatMoney(refreshResult.dividendTotal, currency)}, interest {formatMoney(refreshResult.interestTotal, currency)}.
          </CardContent>
        </Card>
      )}

      {duplicateCheckResult && (
        <Card className="mb-4 border-emerald-300/40 bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardContent className="py-3 text-xs text-emerald-900 dark:text-emerald-200">
            {duplicateCheckResult.autoConfirmed === 0 && duplicateCheckResult.standardDeductionMapped === 0
              ? "No new exact duplicates found."
              : [
                  duplicateCheckResult.autoConfirmed > 0 &&
                    `${duplicateCheckResult.autoConfirmed} exact duplicate row${duplicateCheckResult.autoConfirmed === 1 ? "" : "s"}`,
                  duplicateCheckResult.standardDeductionMapped > 0 &&
                    `${duplicateCheckResult.standardDeductionMapped} salary row${duplicateCheckResult.standardDeductionMapped === 1 ? "" : "s"} explained by the standard deduction`,
                ].filter(Boolean).join(" and ") + " auto-reconciled — excluded from totals below."}
            {duplicateCheckResult.discrepancies > 0 && (
              <>
                {" "}{duplicateCheckResult.discrepancies} pair{duplicateCheckResult.discrepancies === 1 ? "" : "s"} still need
                manual review — see the ⚠ badges below.
              </>
            )}
          </CardContent>
        </Card>
      )}

      {refreshResult && refreshResult.possibleShareSale.count > 0 &&
        !income.some((r) => r.head === "cg_short" || r.head === "cg_long") && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="space-y-2 py-3 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Found {refreshResult.possibleShareSale.count} bank transaction(s) that look like investment/security sale
                proceeds{refreshResult.possibleShareSale.sampleDescriptions.length > 0 && (
                  <> (e.g. "{refreshResult.possibleShareSale.sampleDescriptions[0]}")</>
                )}. Capital gains tax depends on your purchase price and holding period (FIFO), which can't be computed
                from a bank statement — import your broker's Capital Gains Statement to add this accurately.
              </span>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/tax/capital-gains">Import Capital Gains Statement</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {assessment && (
        <Card className="mb-4">
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-4">
            <Stat label="Gross total" v={assessment.gross_total_income} currency={currency} />
            <Stat label="Total income" v={assessment.total_income} currency={currency} />
            <Stat label="Net tax" v={assessment.net_tax_liability} currency={currency} />
            <Stat label="Refund / due" v={assessment.refund_or_balance} currency={currency} />
          </CardContent>
        </Card>
      )}

      <Section title={`Income (${income.length})`} total={totalIncome} currency={currency}>
        {income.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No income rows.</p>
        ) : (
          <ReconRowTable
            rows={income.map((r) => ({
              id: r.id, label: r.label, sub: HEAD_LABELS[r.head], amount: r.amount,
              source: combinedSourceText(r.source_path, incomeBadges.get(r.id)),
            }))}
            badges={incomeBadges}
            currency={currency}
            onMarkDuplicate={(keepId, excludeIds, reason) => markDuplicate("tax_income", keepId, excludeIds, reason)}
            onMarkSumOfGroup={(keepIds, excludeIds, reason) => markSum("tax_income", keepIds, excludeIds, reason)}
            moveLabel="Move to tax payments"
            moveOptions={PAYMENT_TYPE_OPTIONS}
            onMove={(ids, target) => moveToPayments(ids, target as PaymentType)}
          />
        )}
      </Section>

      <Section title={`Deductions (${deductions.length})`} total={totalDeductions} currency={currency}>
        {deductions.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No deductions.</p>
        ) : (
          <RowTable rows={deductions.map((r) => [r.label, r.section, r.amount])} currency={currency} />
        )}
      </Section>

      <Section title={`Tax payments (${payments.length})`} total={totalPayments} currency={currency}>
        {payments.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No payments.</p>
        ) : (
          <ReconRowTable
            rows={payments.map((r) => ({
              id: r.id, ...paymentRowLabel(r), amount: r.amount,
              source: combinedSourceText(r.source_path, paymentBadges.get(r.id)),
            }))}
            badges={paymentBadges}
            currency={currency}
            onMarkDuplicate={(keepId, excludeIds, reason) => markDuplicate("tax_payment", keepId, excludeIds, reason)}
            onMarkSumOfGroup={(keepIds, excludeIds, reason) => markSum("tax_payment", keepIds, excludeIds, reason)}
            moveLabel="Move to income"
            moveOptions={INCOME_HEAD_OPTIONS}
            onMove={(ids, target) => moveToIncome(ids, target as IncomeHead)}
          />
        )}
      </Section>
    </div>
  );
}

function Section({
  title, total, currency, children,
}: {
  title: string; total: number; currency: string; children: React.ReactNode;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
          <span className="font-medium">{title}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatMoney(total, currency)}</span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function RowTable({ rows, currency }: { rows: [string, string, number][]; currency: string }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t first:border-t-0">
            <td className="px-4 py-1.5">{r[0]}</td>
            <td className="px-4 py-1.5 text-xs text-muted-foreground">{r[1]}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{formatMoney(r[2], currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type SortKey = "label" | "sub" | "source" | "amount";

type MarkMode = "duplicate" | "sum" | "move";

/** Same as `RowTable` but for the two tables (income, tax payments) that go through
 *  cross-document reconciliation: sortable by text/type/amount (click a header, click
 *  again to reverse), renders a recon badge under a row's label, and lets the user
 *  select one-or-more rows to manually resolve them — for whatever the automatic
 *  matcher (`domain/recon.ts`) still doesn't catch. Three modes (Move needs only 1
 *  row selected; Duplicates/Sum need 2+):
 *   - Duplicates: the selected rows are the SAME real figure — pick one survivor
 *     (defaults to the lowest id, the earliest-imported), the rest are excluded.
 *   - Sum of group: the selected rows are legitimately different amounts where one
 *     is a total of the others (e.g. AIS's 4 quarterly interest entries vs. one
 *     annual figure elsewhere) — pick which side survives (the total, or the
 *     itemized breakdown), the other side is excluded. Auto-detects which selected
 *     row looks like the total (its amount equals the sum of the rest) and defaults
 *     to it, but it's overridable.
 *   - Move: the parser put the selected row(s) in the wrong table entirely (a TDS
 *     credit that read as `other_sources` income instead of a payment, or the
 *     reverse) — reclassifies them into the sibling table under a picked category.
 *     See `moveIncomeToPayment`/`movePaymentToIncome`. */
function ReconRowTable({
  rows, badges, currency, onMarkDuplicate, onMarkSumOfGroup, moveLabel, moveOptions, onMove,
}: {
  rows: { id: number; label: string; sub: string; source: string; amount: number }[];
  badges: Map<number, ReconBadgeInfo>;
  currency: string;
  onMarkDuplicate: (keepId: number, excludeIds: number[], reason: string) => Promise<void>;
  onMarkSumOfGroup: (keepIds: number[], excludeIds: number[], reason: string) => Promise<void>;
  /** Button text for the Move action, e.g. "Move to tax payments". */
  moveLabel: string;
  /** Target-category vocabulary for the Move dropdown — the sibling table's heads/types. */
  moveOptions: { value: string; label: string }[];
  onMove: (ids: number[], target: string) => Promise<void>;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<MarkMode>("duplicate");
  const [keepOverride, setKeepOverride] = useState<number | null>(null);
  const [aggregateOverride, setAggregateOverride] = useState<number | null>(null);
  const [keepSide, setKeepSide] = useState<"aggregate" | "details">("aggregate");
  const [reason, setReason] = useState("");
  const [marking, setMarking] = useState(false);
  const [moveTarget, setMoveTarget] = useState(moveOptions[0]?.value ?? "");

  // Filters narrow the visible rows so a manual duplicate/sum match — the automatic
  // matcher (`domain/recon.ts`) missing it is exactly when this is needed — is easy to
  // find in a long list: pick a Type/Source to isolate the candidates, or search Text.
  // Selection is deliberately independent of the filter (not cleared/reset on change),
  // so filtering to one source, selecting a row, then re-filtering to another source to
  // find its counterpart, works as one continuous flow.
  const [filterText, setFilterText] = useState("");
  const [filterSub, setFilterSub] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const subOptions = useMemo(() => [...new Set(rows.map((r) => r.sub))].sort(), [rows]);
  const sourceOptions = useMemo(() => [...new Set(rows.map((r) => r.source))].sort(), [rows]);
  const hasFilter = filterText.trim() !== "" || filterSub !== "" || filterSource !== "";
  const clearFilters = () => { setFilterText(""); setFilterSub(""); setFilterSource(""); };

  const filtered = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return rows.filter((r) =>
      (filterSub === "" || r.sub === filterSub) &&
      (filterSource === "" || r.source === filterSource) &&
      (needle === "" || r.label.toLowerCase().includes(needle)),
    );
  }, [rows, filterText, filterSub, filterSource]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) =>
      sortKey === "amount" ? (a.amount - b.amount) * dir : a[sortKey].localeCompare(b[sortKey]) * dir,
    );
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const amountOf = (id: number) => rows.find((r) => r.id === id)?.amount ?? 0;
  const selectedIds = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const selectedTotal = useMemo(() => selectedIds.reduce((s, id) => s + amountOf(id), 0), [selectedIds, rows]);

  // Duplicates/Sum need 2+ rows to make sense; Move works on any non-empty selection
  // (even a single misclassified row) — fall back to Move whenever the selection drops
  // below 2, regardless of which tab was last picked.
  const canMultiMark = selected.size >= 2;
  const effectiveMode: MarkMode = canMultiMark ? mode : "move";

  // Duplicates mode: which row survives.
  const keepId = keepOverride != null && selected.has(keepOverride) ? keepOverride : (selectedIds[0] ?? null);
  const excludeIds = selectedIds.filter((id) => id !== keepId);

  // Sum-of-group mode: which selected row looks like the total (its amount equals the
  // sum of the rest) — auto-detected, but overridable via the dropdown.
  const sumMatchId = useMemo(
    () => selectedIds.find((id) => Math.abs(selectedTotal - 2 * amountOf(id)) < 1) ?? null,
    [selectedIds, selectedTotal, rows],
  );
  const aggregateId = aggregateOverride != null && selected.has(aggregateOverride) ? aggregateOverride : (sumMatchId ?? selectedIds[0] ?? null);
  const detailIds = selectedIds.filter((id) => id !== aggregateId);
  const detailSum = detailIds.reduce((s, id) => s + amountOf(id), 0);
  const aggregateAmount = aggregateId != null ? amountOf(aggregateId) : 0;
  const sumDelta = Math.abs(aggregateAmount - detailSum);

  const clearSelection = () => {
    setSelected(new Set());
    setKeepOverride(null);
    setAggregateOverride(null);
    setKeepSide("aggregate");
    setReason("");
    setMoveTarget(moveOptions[0]?.value ?? "");
  };

  const markSelected = async () => {
    if (keepId == null || excludeIds.length === 0) return;
    setMarking(true);
    try {
      await onMarkDuplicate(keepId, excludeIds, reason);
      clearSelection();
    } finally {
      setMarking(false);
    }
  };

  const markSumSelected = async () => {
    if (aggregateId == null || detailIds.length === 0) return;
    setMarking(true);
    try {
      const keepIds = keepSide === "aggregate" ? [aggregateId] : detailIds;
      const excl = keepSide === "aggregate" ? detailIds : [aggregateId];
      await onMarkSumOfGroup(keepIds, excl, reason);
      clearSelection();
    } finally {
      setMarking(false);
    }
  };

  const markMoveSelected = async () => {
    if (selectedIds.length === 0 || !moveTarget) return;
    setMarking(true);
    try {
      await onMove(selectedIds, moveTarget);
      clearSelection();
    } finally {
      setMarking(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-1.5 text-xs">
        <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          placeholder="Search text…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="h-7 w-36 text-xs"
        />
        <select
          className="rounded border bg-background px-1.5 py-1 text-xs"
          value={filterSub}
          onChange={(e) => setFilterSub(e.target.value)}
        >
          <option value="">All types</option>
          {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="rounded border bg-background px-1.5 py-1 text-xs"
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
        >
          <option value="">All sources</option>
          {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {hasFilter && (
          <button type="button" onClick={clearFilters} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-muted-foreground">
          {hasFilter ? `${sorted.length} of ${rows.length} shown` : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-t text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="w-8 px-2 py-1.5" />
            <SortHeader label="Text" active={sortKey === "label"} dir={sortDir} onClick={() => toggleSort("label")} />
            <SortHeader label="Type" active={sortKey === "sub"} dir={sortDir} onClick={() => toggleSort("sub")} />
            <SortHeader label="Source" active={sortKey === "source"} dir={sortDir} onClick={() => toggleSort("source")} />
            <SortHeader label="Amount" active={sortKey === "amount"} dir={sortDir} onClick={() => toggleSort("amount")} align="right" />
          </tr>
        </thead>
        <tbody>
        {selected.size >= 1 && (
          <tr className="border-t bg-amber-50/40 dark:bg-amber-950/10">
            <td colSpan={5} className="px-4 py-2">
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{selected.size} selected —</span>
                  <div className="inline-flex overflow-hidden rounded border">
                    {canMultiMark && (
                      <>
                        <button
                          type="button"
                          onClick={() => setMode("duplicate")}
                          className={`px-2 py-1 ${effectiveMode === "duplicate" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                        >
                          Duplicates
                        </button>
                        <button
                          type="button"
                          onClick={() => setMode("sum")}
                          className={`px-2 py-1 ${effectiveMode === "sum" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                        >
                          Sum of group
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setMode("move")}
                      className={`px-2 py-1 ${effectiveMode === "move" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                    >
                      Move
                    </button>
                  </div>
                </div>

                {effectiveMode === "duplicate" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded border bg-background px-1.5 py-1 text-xs"
                      value={keepId ?? ""}
                      onChange={(e) => setKeepOverride(Number(e.target.value))}
                    >
                      {selectedIds.map((id) => {
                        const r = rows.find((x) => x.id === id);
                        return <option key={id} value={id}>{`Keep: ${r?.label ?? id}`}</option>;
                      })}
                    </select>
                    <Input
                      placeholder="Reason (optional)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="h-7 max-w-[220px] text-xs"
                    />
                    <Button size="sm" onClick={() => void markSelected()} disabled={marking}>
                      {marking ? "Marking…" : "Mark as duplicate"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
                  </div>
                ) : effectiveMode === "sum" ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Total row:</span>
                      <select
                        className="rounded border bg-background px-1.5 py-1 text-xs"
                        value={aggregateId ?? ""}
                        onChange={(e) => setAggregateOverride(Number(e.target.value))}
                      >
                        {selectedIds.map((id) => {
                          const r = rows.find((x) => x.id === id);
                          return <option key={id} value={id}>{`${r?.label ?? id} (${formatMoney(amountOf(id), currency)})`}</option>;
                        })}
                      </select>
                      <label className="inline-flex items-center gap-1">
                        <input type="radio" checked={keepSide === "aggregate"} onChange={() => setKeepSide("aggregate")} /> Keep total row
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input type="radio" checked={keepSide === "details"} onChange={() => setKeepSide("details")} /> Keep itemized rows
                      </label>
                    </div>
                    <p className={sumDelta < 1 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      Itemized total {formatMoney(detailSum, currency)} vs. total row {formatMoney(aggregateAmount, currency)}
                      {sumDelta < 1 ? " — matches exactly." : ` — Δ ${formatMoney(sumDelta, currency)}, check before marking.`}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        placeholder="Reason (optional)"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="h-7 max-w-[220px] text-xs"
                      />
                      <Button size="sm" onClick={() => void markSumSelected()} disabled={marking}>
                        {marking ? "Marking…" : "Mark as sum of group"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Reclassify as:</span>
                    <select
                      className="rounded border bg-background px-1.5 py-1 text-xs"
                      value={moveTarget}
                      onChange={(e) => setMoveTarget(e.target.value)}
                    >
                      {moveOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <Button size="sm" onClick={() => void markMoveSelected()} disabled={marking || !moveTarget}>
                      {marking ? "Moving…" : moveLabel}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
        {sorted.length === 0 && (
          <tr className="border-t">
            <td colSpan={5} className="px-4 py-3 text-center text-xs text-muted-foreground">
              No rows match the current filter.
            </td>
          </tr>
        )}
        {sorted.map((r) => (
          <tr key={r.id} className="border-t first:border-t-0">
            <td className="px-2 py-1.5">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggleSelect(r.id)}
                className="h-3.5 w-3.5 cursor-pointer align-middle"
                aria-label={`Select "${r.label}" for duplicate marking`}
              />
            </td>
            <td className="px-4 py-1.5">
              {r.label}
              <ReconBadge info={badges.get(r.id)} currency={currency} />
            </td>
            <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.sub}</td>
            <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.source}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{formatMoney(r.amount, currency)}</td>
          </tr>
        ))}
      </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label, active, dir, onClick, align = "left",
}: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right";
}) {
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`px-4 py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-0.5 hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function ReconBadge({ info, currency }: { info: ReconBadgeInfo | undefined; currency: string }) {
  if (!info) return null;
  if (info.reconciledFrom) {
    const text = info.reconciledFrom.map((r) => `${r.label} (${r.reason})`).join(", ");
    return (
      <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3 shrink-0" /> Reconciled with {text}
      </div>
    );
  }
  if (info.discrepancy) {
    const { ownLabel, otherLabel, otherAmount, delta } = info.discrepancy;
    return (
      <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {ownLabel ?? "this row"} vs {otherLabel ?? "another source"}: {formatMoney(otherAmount, currency)} (Δ {formatMoney(delta, currency)}) — needs recon
      </div>
    );
  }
  return null;
}

function Stat({ label, v, currency }: { label: string; v: number | null; currency: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{v != null ? formatMoney(v, currency) : "—"}</p>
    </div>
  );
}
