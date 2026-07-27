import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Archive, ArchiveRestore, ArrowLeft, GitMerge, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { carryForwardSeries } from "@/domain/calc";
import { SnapshotForm, type SnapshotFormValues } from "@/components/snapshots/SnapshotForm";
import { AccountForm } from "@/components/accounts/AccountForm";
import { CredentialPanel } from "@/components/vault/CredentialPanel";
import { DocumentAttach } from "@/components/documents/DocumentAttach";
import { EmergencyActionButton } from "@/components/emergency/EmergencyActionButton";
import { EMERGENCY_DISCLAIMER, hasActionableContact, mentionsContact } from "@/lib/emergency";
import { isTauri } from "@/lib/environment";
import { formatMonthLabel, formatMoney, transactionDateLabel } from "@/lib/format";
import {
  archiveAccount, deleteAccount, getAccount, getCredentialRef, updateAccount,
  type Account, type AccountInput,
} from "@/db/accounts";
import { removeCredential } from "@/vault/stronghold";
import { useVaultStore } from "@/stores/vault.store";
import { accountTypeLabel } from "@/lib/accountTypes";
import { SipChip } from "@/components/accounts/SipChip";
import { PageHeader } from "@/components/layout/PageHeader";
import { DesktopOnlyNotice } from "@/components/layout/DesktopOnlyNotice";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import {
  deleteSnapshot,
  listSnapshotsForAccount,
  upsertSnapshot,
  type Snapshot,
} from "@/db/snapshots";
import { listTransactionsForAccount, countTransactionsForAccount, listAllTransactions, type TransactionRow } from "@/db/transactions";
import { listAllTags } from "@/db/transactionTags";
import { listAllLinks } from "@/db/reconLinks";
import { findSelfTransferCandidates, type MatchableTransaction } from "@/domain/transferMatching";
import { MASTERS } from "@/masters/registry";

const CATEGORY_LABELS = new Map(MASTERS.transaction_category.baked.map((o) => [o.value, o.label]));

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const accountId = Number(id);

  const [account, setAccount] = useState<Account | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [transactionCount, setTransactionCount] = useState(0);
  const [transferCandidateCount, setTransferCandidateCount] = useState(0);
  const [matchCounts, setMatchCounts] = useState<Map<number, number>>(new Map());
  const [tagsByTxn, setTagsByTxn] = useState<Map<number, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { unlocked } = useVaultStore();
  const isDesktop = useIsDesktop();

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    if (!Number.isFinite(accountId)) {
      setError("Invalid account id");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [acc, snaps, txns, txnCount, allTxns, links, tags] = await Promise.all([
        getAccount(accountId),
        listSnapshotsForAccount(accountId),
        isDesktop ? listTransactionsForAccount(accountId, 20) : Promise.resolve([]),
        isDesktop ? countTransactionsForAccount(accountId) : Promise.resolve(0),
        isDesktop ? listAllTransactions() : Promise.resolve([]),
        isDesktop ? listAllLinks() : Promise.resolve([]),
        isDesktop ? listAllTags() : Promise.resolve([]),
      ]);
      if (!acc) {
        setError("Account not found");
      } else {
        setAccount(acc);
        setSnapshots(snaps);
        setTransactions(txns);
        setTransactionCount(txnCount);
        setTransferCandidateCount(countTransferCandidatesTouching(allTxns, accountId));
        const tagMap = new Map<number, string[]>();
        for (const t of tags) {
          const list = tagMap.get(t.transaction_id);
          if (list) list.push(t.category);
          else tagMap.set(t.transaction_id, [t.category]);
        }
        setTagsByTxn(tagMap);
        // Only CONFIRMED links earn a tag — see Transactions.tsx's same logic.
        const counts = new Map<number, number>();
        for (const l of links) {
          if (l.status !== "confirmed") continue;
          if (l.a_kind === "transaction") counts.set(l.a_id, (counts.get(l.a_id) ?? 0) + 1);
          if (l.b_kind === "transaction") counts.set(l.b_id, (counts.get(l.b_id) ?? 0) + 1);
        }
        setMatchCounts(counts);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, isDesktop]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Most recent snapshot value = the account's current balance (snapshots are
  // sorted newest-first by listSnapshotsForAccount). null when none recorded yet.
  const current = useMemo(
    () => (snapshots.length > 0 ? [...snapshots].sort((a, b) => b.month.localeCompare(a.month))[0] : null),
    [snapshots],
  );

  // Carry-forward trend for this single account, mirroring the Dashboard's total-savings chart.
  const series = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const s of snapshots) byMonth.set(s.month, s.value);
    return carryForwardSeries(byMonth);
  }, [snapshots]);

  const handleSave = async (values: SnapshotFormValues) => {
    await upsertSnapshot({
      account_id: accountId,
      month: values.month,
      value: values.value,
      note: values.note ?? null,
      source: "manual",
    });
    setAdding(false);
    await refresh();
  };

  const handleDelete = async (snapId: number) => {
    await deleteSnapshot(snapId);
    await refresh();
  };

  const handleArchiveToggle = async () => {
    if (!account) return;
    await archiveAccount(account.id, account.is_archived === 0);
    await refresh();
  };

  const handleUpdateAccount = async (input: AccountInput) => {
    if (!account) return;
    await updateAccount(account.id, input);
    setEditing(false);
    await refresh();
  };

  const handleDeleteAccount = async () => {
    if (!account) return;
    setDeleting(true);
    setError(null);
    try {
      // Best-effort: drop the Stronghold secret while the vault is unlocked. Its
      // vault_entries row and the account's snapshots/reminders are removed by
      // deleteAccount regardless.
      if (unlocked) {
        const ref = await getCredentialRef(account.id);
        if (ref) {
          try {
            await removeCredential(ref.stronghold_key);
          } catch {
            /* secret already gone — ignore */
          }
        }
      }
      await deleteAccount(account.id);
      navigate("/accounts");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <BackLink />
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            This page reads from SQLite, which requires the desktop/mobile app. Start with{" "}
            <code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code>.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (error || !account) {
    return (
      <div className="container max-w-3xl py-6">
        <BackLink />
        <Card className="mt-4 border-destructive/60">
          <CardContent className="py-3 text-sm text-destructive">{error ?? "Not found"}</CardContent>
        </Card>
        <Button variant="ghost" className="mt-3" onClick={() => navigate("/accounts")}>
          Back to accounts
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo="/accounts"
        backLabel="Back to accounts"
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate">{account.name}</span>
            {account.is_archived === 1 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Archived
              </span>
            )}
            <SipChip account={account} />
          </span>
        }
        description={
          editing ? undefined : (
            <>
              {account.type === "other" && account.type_note ? account.type_note : accountTypeLabel(account.type)} · {account.institution ?? "no institution"}
              {account.is_family ? (
                <> · <span className="font-medium">Family ({account.family_relation === "minor" ? "minor child" : "adult"})</span></>
              ) : null} ·
              {current
                ? <> current {formatMoney(current.value, account.currency)} (as of {formatMonthLabel(current.month)}) · opening {formatMoney(account.opening_balance, account.currency)}</>
                : <> opening {formatMoney(account.opening_balance, account.currency)}</>}
              {account.type === "fixed_deposit" && account.maturity_date && (
                <> · matures {account.maturity_date}</>
              )}
            </>
          )
        }
        actions={
          editing ? undefined : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={handleArchiveToggle}>
                {account.is_archived === 1 ? (
                  <>
                    <ArchiveRestore className="h-4 w-4" /> Unarchive
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" /> Archive
                  </>
                )}
              </Button>
            </div>
          )
        }
      />

      {editing && (
        <section className="mb-6">
          <AccountForm
            initial={account}
            defaultCurrency={account.currency}
            onSubmit={handleUpdateAccount}
            onCancel={() => setEditing(false)}
          />
        </section>
      )}

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Credential
        </h3>
        <CredentialPanel accountId={accountId} accountName={account.name} />
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Documents
        </h3>
        <DocumentAttach accountId={accountId} />
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Prepare for emergencies
        </h3>
        <Card>
          <CardContent className="space-y-3 py-4">
            {account.emergency_action?.trim() || account.contact?.trim() ? (
              <>
                {account.emergency_action?.trim() && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">What to do</p>
                    <p className="whitespace-pre-wrap text-sm">{account.emergency_action}</p>
                  </div>
                )}
                {account.contact?.trim() && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Contact</p>
                    <p className="text-sm">{account.contact}</p>
                  </div>
                )}
                {hasActionableContact(account) ? (
                  <EmergencyActionButton account={account} size="sm" />
                ) : (
                  mentionsContact(account.emergency_action) && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      This action mentions contacting someone — edit this account on the{" "}
                      <Link to="/accounts" className="underline">Accounts</Link> page to add a contact and
                      enable the "Press during Emergency" button.
                    </p>
                  )
                )}
                <p className="text-[11px] leading-snug text-muted-foreground">{EMERGENCY_DISCLAIMER}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No emergency action recorded. Edit this account on the{" "}
                <Link to="/accounts" className="underline">Accounts</Link> page to add what your family
                should do and who to contact.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {series.length > 0 && (
        <section className="mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trend</CardTitle>
              <CardDescription>Balance, month over month (carry-forward).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} width={64} tickFormatter={(v) => compactCurrency(v, account.currency)} />
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, account.currency)}
                      labelFormatter={(m) => formatMonthLabel(String(m))}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Transactions
        </h3>
        {!isDesktop ? (
          <DesktopOnlyNotice feature="The transaction ledger" />
        ) : transactions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No transactions recorded yet — import a{" "}
              <Link to={`/import/statement-pdf?account=${accountId}`} className="underline">bank statement</Link> to see them here.
            </CardContent>
          </Card>
        ) : (
          <>
            {transferCandidateCount > 0 && (
              <Link
                to={`/transactions/matches?account=${accountId}`}
                className="mb-2 block rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary underline-offset-2 hover:underline"
              >
                {transferCandidateCount} possible transfer{transferCandidateCount === 1 ? "" : "s"} to/from another account — review
              </Link>
            )}
            <ul className="divide-y rounded-lg border bg-card">
              {transactions.map((t) => (
                <li key={t.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{transactionDateLabel(t)}</span>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {t.debit != null ? "To:" : t.credit != null ? "From:" : null}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">{t.description}</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {matchCounts.has(t.id) && (
                        <span className="inline-flex items-center gap-0.5 normal-case text-primary">
                          <GitMerge className="h-3 w-3" /> Matched with {matchCounts.get(t.id)} document{matchCounts.get(t.id) === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(tagsByTxn.get(t.id) ?? []).length > 0 ? (
                        (tagsByTxn.get(t.id) ?? []).map((c) => (
                          <span key={c} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                            {CATEGORY_LABELS.get(c) ?? c}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Uncategorized</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    {t.debit != null && (
                      <div className="font-medium text-destructive">-{formatMoney(t.debit, account.currency)}</div>
                    )}
                    {t.credit != null && (
                      <div className="font-medium text-emerald-600 dark:text-emerald-400">+{formatMoney(t.credit, account.currency)}</div>
                    )}
                    {t.balance != null && (
                      <div className="text-xs text-muted-foreground">{formatMoney(t.balance, account.currency)}</div>
                    )}
                    {t.debit == null && t.credit == null && t.balance == null && (
                      <div className="text-muted-foreground">—</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {transactionCount > transactions.length && (
              <div className="mt-2 text-right">
                <Link to={`/transactions?account=${accountId}`} className="text-xs text-muted-foreground underline">
                  View all {transactionCount} transactions →
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Monthly history
          </h3>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add / update month
            </Button>
          )}
        </div>

        {adding && (
          <div className="mb-3">
            <SnapshotForm
              currency={account.currency}
              onSubmit={handleSave}
              onCancel={() => setAdding(false)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Saving a month that already exists will overwrite it.
            </p>
          </div>
        )}

        {snapshots.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No monthly snapshots yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {snapshots.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{formatMonthLabel(s.month)}</span>
                    {s.source === "import" && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">imported</span>
                    )}
                  </div>
                  {s.note && <p className="text-xs text-muted-foreground truncate">{s.note}</p>}
                </div>
                <div className="text-right">
                  <div className="font-medium tabular-nums">{formatMoney(s.value, account.currency)}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)} aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {account.is_archived === 1 && (
        <section className="mb-6">
          <Card className="border-destructive/40">
            <CardContent className="space-y-3 py-4">
              <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Delete this account</span> — permanently removes{" "}
                {account.name}, its {snapshots.length} monthly value{snapshots.length === 1 ? "" : "s"}
                {transactionCount > 0 && <> and {transactionCount} transaction{transactionCount === 1 ? "" : "s"}</>}, any saved
                credential, and reminders linked to it. Attached documents are kept (their link is cleared). This
                cannot be undone.
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              {confirmingDelete ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">Delete this account for good?</span>
                  <Button variant="destructive" size="sm" onClick={handleDeleteAccount} disabled={deleting}>
                    {deleting ? "Deleting…" : "Yes, delete account"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 className="h-4 w-4" /> Delete account
                </Button>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

/** How many detected self-transfer candidates (see domain/transferMatching) touch this
 *  account — drives the "possible transfers — review" banner in the Transactions section. */
function countTransferCandidatesTouching(allTransactions: TransactionRow[], accountId: number): number {
  const matchable: MatchableTransaction[] = [];
  for (const t of allTransactions) {
    if (t.match_status !== "none" || !t.date) continue;
    if (t.debit != null) matchable.push({ id: t.id, accountId: t.account_id, date: t.date, amount: t.debit, direction: "debit" });
    else if (t.credit != null) matchable.push({ id: t.id, accountId: t.account_id, date: t.date, amount: t.credit, direction: "credit" });
  }
  const candidates = findSelfTransferCandidates(matchable);
  return candidates.filter((c) => c.outgoingAccountId === accountId || c.incomingAccountId === accountId).length;
}

function compactCurrency(value: number, currency: string): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${currency} ${(value / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${currency} ${(value / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${currency} ${(value / 1_000).toFixed(1)}K`;
  return `${currency} ${value.toFixed(0)}`;
}

function BackLink() {
  return (
    <Link
      to="/accounts"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to accounts
    </Link>
  );
}
