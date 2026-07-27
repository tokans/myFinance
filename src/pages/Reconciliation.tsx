import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { DesktopOnlyNotice } from "@/components/layout/DesktopOnlyNotice";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { listPaymentsAll, listIncomeAll, type TaxPaymentRow, type TaxIncomeRow } from "@/db/tax";
import { listAllTransactions, type TransactionRow } from "@/db/transactions";
import { listAccounts, type Account } from "@/db/accounts";
import {
  listAllLinks, upsertSuggestedLinks, confirmLink, dismissLink, unconfirmLink, runAutoRecon,
  type ReconLinkRow, type ReconKind,
} from "@/db/reconLinks";
import { suggestTransactionPaymentLinks, suggestTransactionIncomeLinks, reconNoteReasonLabel } from "@/domain/recon";

/** Payment types the account holder pays themselves via net-banking challan
 *  — the only ones expected to show up as a matching bank debit. TDS/TCS is
 *  withheld by a third party before the user ever sees the money. */
const USER_PAID_PAYMENT_TYPES = new Set(["advance", "self_assessment"]);

const KIND_LABEL: Record<ReconKind, string> = {
  transaction: "Bank transaction",
  tax_income: "Tax income",
  tax_payment: "Tax payment",
  ais_sft: "AIS SFT",
  tax_refund: "Refund",
};

/**
 * One-stop reconciliation hub for an assessment year (desktop-only, like the
 * rest of the transaction ledger it depends on): cross-document duplicates
 * (the same TDS/income reported by two different imported documents) and
 * bank-transaction-to-tax-document matches. Candidates are computed
 * client-side (`domain/recon.ts`) and persisted as 'suggested' links
 * (`db/reconLinks.ts`) so confirm/dismiss decisions survive a page reload
 * and don't resurface — same idiom as `TransactionMatchesPage`'s self-transfer
 * review. SFT cross-check has its own established page (`/tax/:ay/sft`) and
 * stays there rather than being rebuilt here.
 */
export function ReconciliationPage() {
  const { ay = "" } = useParams<{ ay: string }>();
  const isDesktop = useIsDesktop();
  const currency = useSettingsStore((s) => s.settings.currency);

  const [payments, setPayments] = useState<TaxPaymentRow[]>([]);
  const [income, setIncome] = useState<TaxIncomeRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [links, setLinks] = useState<ReconLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  // A delta recon (amounts don't quite agree) requires the user to say WHY they're
  // accepting it before it can be confirmed — one draft reason per pending link.
  const [reasonDrafts, setReasonDrafts] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    if (!isTauri() || !isDesktop) { setLoading(false); return; }
    setLoading(true);

    // Cross-document duplicates: computed + persisted by the shared helper, which also
    // auto-confirms the exact-match tier (see `runAutoRecon`'s doc comment) — only the
    // genuine discrepancies stay 'suggested' for this page to surface below.
    await runAutoRecon(ay);

    const [pay, inc, txns, accts] = await Promise.all([
      listPaymentsAll(ay), listIncomeAll(ay), listAllTransactions(), listAccounts({ includeArchived: true }),
    ]);

    const userPaidPayments = pay.filter((p) => USER_PAID_PAYMENT_TYPES.has(p.type));
    const candidates = [
      ...suggestTransactionPaymentLinks(
        txns.map((t) => ({ id: t.id, debit: t.debit, credit: t.credit })),
        userPaidPayments.map((p) => ({ id: p.id, amount: p.amount, type: p.type })),
      ),
      ...suggestTransactionIncomeLinks(
        txns.map((t) => ({ id: t.id, debit: t.debit, credit: t.credit })),
        inc.map((r) => ({ id: r.id, amount: r.amount })),
      ),
    ];
    await upsertSuggestedLinks(candidates);

    const allLinks = await listAllLinks();
    const paymentIds = new Set(pay.map((p) => p.id));
    const incomeIds = new Set(inc.map((r) => r.id));
    const relevant = allLinks.filter((l) => {
      const touches = (kind: ReconKind, id: number) =>
        (kind === "tax_payment" && paymentIds.has(id)) || (kind === "tax_income" && incomeIds.has(id)) || kind === "transaction";
      return touches(l.a_kind, l.a_id) && touches(l.b_kind, l.b_id);
    });

    setPayments(pay);
    setIncome(inc);
    setTransactions(txns);
    setAccounts(accts);
    setLinks(relevant);
    setLoading(false);
  }, [ay, isDesktop]);

  useEffect(() => { void refresh(); }, [refresh]);

  const paymentById = useMemo(() => new Map(payments.map((p) => [p.id, p])), [payments]);
  const incomeById = useMemo(() => new Map(income.map((r) => [r.id, r])), [income]);
  const transactionById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const isDuplicatePair = (l: ReconLinkRow) => l.a_kind !== "transaction" && l.b_kind !== "transaction";
  const duplicateLinks = useMemo(
    () => links.filter((l) => l.status === "suggested" && isDuplicatePair(l)),
    [links],
  );
  // Everything the loader already confirmed — either auto (exact match / standard
  // deduction) or manually with a reason — shown here as an audit trail with an undo,
  // not as something the user needs to act on.
  const reconciledLinks = useMemo(
    () => links.filter((l) => l.status === "confirmed" && isDuplicatePair(l)),
    [links],
  );
  // A group of 3+ documents reporting the same figure produces one pairwise link per
  // PAIR (see `domain/recon.ts`), which would otherwise render as N-choose-2 near-identical
  // cards. Group them by the surviving (non-excluded) record instead, so "Form 16, AIS and
  // TIS all report this salary" shows as ONE card listing every excluded duplicate beneath it.
  const reconciledGroups = useMemo(() => {
    const isExcluded = (kind: ReconKind, id: number): boolean =>
      (kind === "tax_income" ? incomeById.get(id)?.excluded : kind === "tax_payment" ? paymentById.get(id)?.excluded : undefined) ?? false;
    const groups = new Map<string, { winner: { kind: ReconKind; id: number }; members: { kind: ReconKind; id: number; linkId: number; reason: string }[] }>();
    for (const l of reconciledLinks) {
      const winner = isExcluded(l.a_kind, l.a_id) ? { kind: l.b_kind, id: l.b_id } : { kind: l.a_kind, id: l.a_id };
      const loser = isExcluded(l.a_kind, l.a_id) ? { kind: l.a_kind, id: l.a_id } : { kind: l.b_kind, id: l.b_id };
      const key = `${winner.kind}-${winner.id}`;
      const group = groups.get(key) ?? { winner, members: [] };
      group.members.push({ ...loser, linkId: l.id, reason: reconNoteReasonLabel(l.note) });
      groups.set(key, group);
    }
    return Array.from(groups.entries()).map(([key, g]) => ({ key, ...g }));
  }, [reconciledLinks, incomeById, paymentById]);
  const matchLinks = useMemo(
    () => links.filter((l) => l.status === "suggested" && (l.a_kind === "transaction" || l.b_kind === "transaction")),
    [links],
  );

  const act = async (linkId: number, action: "confirm" | "dismiss" | "undo", reason?: string) => {
    setActing(linkId);
    if (action === "confirm") await confirmLink(linkId, reason);
    else if (action === "dismiss") await dismissLink(linkId);
    else await unconfirmLink(linkId);
    setActing(null);
    setReasonDrafts((prev) => {
      const next = { ...prev };
      delete next[linkId];
      return next;
    });
    await refresh();
  };

  const describeRecord = (kind: ReconKind, id: number): { label: string; amount: number | null; source: string | null } | null => {
    if (kind === "tax_payment") {
      const r = paymentById.get(id);
      return r ? { label: r.payer_name ? `${r.type} — ${r.payer_name}` : r.type, amount: r.amount, source: r.source_path } : null;
    }
    if (kind === "tax_income") {
      const r = incomeById.get(id);
      return r ? { label: r.label, amount: r.amount, source: r.source_path } : null;
    }
    if (kind === "transaction") {
      const t = transactionById.get(id);
      if (!t) return null;
      const acct = accountById.get(t.account_id);
      return {
        label: `${acct?.name ?? `Account ${t.account_id}`} — ${t.description}`,
        amount: t.debit ?? t.credit,
        source: t.date ?? t.raw_date,
      };
    }
    return null;
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <PageHeader backTo={`/tax/${encodeURIComponent(ay)}`} backLabel="Back to tax year" title="Reconciliation" />
        <DesktopOnlyNotice feature="The transaction ledger" />
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo={`/tax/${encodeURIComponent(ay)}`}
        backLabel="Back to tax year"
        title="Reconciliation"
        description="Cross-document duplicates and bank-ledger matches for this assessment year — nothing here changes a saved figure until you confirm it."
      />

      {!isDesktop ? (
        <DesktopOnlyNotice feature="The transaction ledger" />
      ) : loading ? (
        <div className="py-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6">
          <Card className="border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
            <CardContent className="flex items-center justify-between gap-3 py-3 text-xs text-blue-900 dark:text-blue-200">
              <span>Large-value transactions reported to the tax department vs. your own bank ledger, with SFT codes.</span>
              <Button asChild size="sm" variant="outline">
                <Link to={`/tax/${encodeURIComponent(ay)}/sft`}>
                  SFT cross-check <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/10">
            <CardContent className="flex items-center justify-between gap-3 py-3 text-xs text-blue-900 dark:text-blue-200">
              <span>Check your own figures against your Chartered Accountant's tax computation sheet, category by category.</span>
              <Button asChild size="sm" variant="outline">
                <Link to={`/tax/${encodeURIComponent(ay)}/ca-recon`}>
                  CA computation check <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Duplicates with a discrepancy ({duplicateLinks.length})</h3>
            <p className="text-xs text-muted-foreground">
              Two different imported documents reported what looks like the same figure (same category, same entity)
              but the amounts don't quite match — an exact match is auto-reconciled without asking (see below), so
              everything here needs your judgment call on which figure is right before excluding one from your totals.
            </p>
            {duplicateLinks.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No duplicate candidates found.</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {duplicateLinks.map((l) => {
                  const a = describeRecord(l.a_kind, l.a_id);
                  const b = describeRecord(l.b_kind, l.b_id);
                  if (!a || !b) return null;
                  const reason = reasonDrafts[l.id] ?? "";
                  return (
                    <Card key={l.id}>
                      <CardContent className="space-y-3 py-4">
                        <RecordRow kindLabel={KIND_LABEL[l.a_kind]} record={a} currency={currency} />
                        <RecordRow kindLabel={KIND_LABEL[l.b_kind]} record={b} currency={currency} />
                        <Input
                          placeholder="Reason for accepting this delta (required to confirm) — e.g. '26AS not yet updated for Q4'"
                          value={reason}
                          onChange={(e) => setReasonDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                          className="text-xs"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => void act(l.id, "dismiss")} disabled={acting === l.id}>
                            <X className="h-4 w-4" /> Not a duplicate
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void act(l.id, "confirm", reason)}
                            disabled={acting === l.id || !reason.trim()}
                          >
                            <Check className="h-4 w-4" /> Confirm duplicate
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Reconciled ({reconciledGroups.length})</h3>
            <p className="text-xs text-muted-foreground">
              Grouped by the figure that survives — every other document reporting the same amount is excluded from
              your totals beneath it, either automatically (exact match, or a salary gap explained by the standard
              deduction) or manually with your reason. Undo a single duplicate to bring just that one back into your
              totals.
            </p>
            {reconciledGroups.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">Nothing reconciled yet.</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {reconciledGroups.map((g) => {
                  const winnerRecord = describeRecord(g.winner.kind, g.winner.id);
                  if (!winnerRecord) return null;
                  return (
                    <Card key={g.key}>
                      <CardContent className="space-y-3 py-4">
                        <div>
                          <span className="mb-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Kept
                          </span>
                          <RecordRow kindLabel={KIND_LABEL[g.winner.kind]} record={winnerRecord} currency={currency} />
                        </div>
                        <div className="space-y-2 border-t pt-2">
                          {g.members.map((m) => {
                            const record = describeRecord(m.kind, m.id);
                            if (!record) return null;
                            return (
                              <div key={m.linkId} className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <RecordRow kindLabel={KIND_LABEL[m.kind]} record={record} currency={currency} />
                                  <p className="pl-[9.5rem] text-[10px] text-muted-foreground">Excluded — {m.reason}</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => void act(m.linkId, "undo")} disabled={acting === m.linkId}>
                                  Undo
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Bank ↔ tax-document matches ({matchLinks.length})</h3>
            <p className="text-xs text-muted-foreground">
              A bank transaction that lines up with a reported tax payment or income figure — confirming tags the
              transaction with which document it matched.
            </p>
            {matchLinks.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No match candidates found.</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {matchLinks.map((l) => {
                  const a = describeRecord(l.a_kind, l.a_id);
                  const b = describeRecord(l.b_kind, l.b_id);
                  if (!a || !b) return null;
                  return (
                    <Card key={l.id}>
                      <CardContent className="space-y-2 py-4">
                        <RecordRow kindLabel={KIND_LABEL[l.a_kind]} record={a} currency={currency} />
                        <RecordRow kindLabel={KIND_LABEL[l.b_kind]} record={b} currency={currency} />
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => void act(l.id, "dismiss")} disabled={acting === l.id}>
                            <X className="h-4 w-4" /> Not a match
                          </Button>
                          <Button size="sm" onClick={() => void act(l.id, "confirm")} disabled={acting === l.id}>
                            <Check className="h-4 w-4" /> Confirm match
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function RecordRow({ kindLabel, record, currency }: { kindLabel: string; record: { label: string; amount: number | null; source: string | null }; currency: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{kindLabel}</span>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm">{record.label}</p>
        {record.source && <p className="truncate text-xs text-muted-foreground">{record.source}</p>}
      </div>
      <div className="shrink-0 font-medium tabular-nums">{record.amount != null ? formatMoney(record.amount, currency) : "—"}</div>
    </div>
  );
}
