import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { DesktopOnlyNotice } from "@/components/layout/DesktopOnlyNotice";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import { findSelfTransferCandidates, type MatchableTransaction, type TransferCandidate } from "@/domain/transferMatching";
import { listAllTransactions, confirmMatch, dismissMatch, type TransactionRow } from "@/db/transactions";
import { listAccounts, type Account } from "@/db/accounts";

/**
 * Cross-account self-transfer review — inherently spans two accounts, so this
 * gets its own page (route `/transactions/matches`) rather than living inside
 * either account's AccountDetail section. Match state is device-local (see
 * `sync/spec.ts`'s `transactions` entry) — a self-referencing FK the
 * single-pass sync merge engine can't safely round-trip.
 */
export function TransactionMatchesPage() {
  const [searchParams] = useSearchParams();
  const accountFilter = searchParams.get("account");
  const isDesktop = useIsDesktop();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri() || !isDesktop) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [txns, accts] = await Promise.all([
      listAllTransactions(),
      listAccounts({ includeArchived: true }),
    ]);
    setTransactions(txns);
    setAccounts(accts);
    setLoading(false);
  }, [isDesktop]);

  useEffect(() => { void refresh(); }, [refresh]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const transactionById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);

  const candidates = useMemo(() => {
    const matchable: MatchableTransaction[] = [];
    for (const t of transactions) {
      if (t.match_status !== "none" || !t.date) continue;
      if (t.debit != null) matchable.push({ id: t.id, accountId: t.account_id, date: t.date, amount: t.debit, direction: "debit" });
      else if (t.credit != null) matchable.push({ id: t.id, accountId: t.account_id, date: t.date, amount: t.credit, direction: "credit" });
    }
    let found = findSelfTransferCandidates(matchable);
    if (accountFilter) {
      const acctId = Number(accountFilter);
      found = found.filter((c) => c.outgoingAccountId === acctId || c.incomingAccountId === acctId);
    }
    return found;
  }, [transactions, accountFilter]);

  const act = async (c: TransferCandidate, action: "confirm" | "dismiss") => {
    setActing(c.outgoingId);
    if (action === "confirm") await confirmMatch(c.outgoingId, c.incomingId);
    else await dismissMatch(c.outgoingId, c.incomingId);
    setActing(null);
    await refresh();
  };

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <PageHeader backTo="/transactions" backLabel="Back to transactions" title="Possible transfers" />
        <DesktopOnlyNotice feature="The transaction ledger" />
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo="/transactions"
        backLabel="Back to transactions"
        title="Possible transfers"
        description="Outgoing and incoming transactions across your own accounts that look like the same transfer — confirm or dismiss each pair."
      />

      {!isDesktop ? (
        <DesktopOnlyNotice feature="The transaction ledger" />
      ) : loading ? (
        <div className="py-6 text-sm text-muted-foreground">Loading…</div>
      ) : candidates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No possible transfers to review right now.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => {
            const out = transactionById.get(c.outgoingId);
            const inc = transactionById.get(c.incomingId);
            if (!out || !inc) return null;
            const outAcct = accountById.get(out.account_id);
            const incAcct = accountById.get(inc.account_id);
            return (
              <Card key={`${c.outgoingId}-${c.incomingId}`}>
                <CardContent className="space-y-2 py-4">
                  <Row label="Out" account={outAcct?.name ?? `Account ${out.account_id}`} row={out} currency={outAcct?.currency ?? "INR"} />
                  <Row label="In" account={incAcct?.name ?? `Account ${inc.account_id}`} row={inc} currency={incAcct?.currency ?? "INR"} />
                  <p className="text-xs text-muted-foreground">
                    {c.dateDeltaDays === 0 ? "same day" : `${c.dateDeltaDays.toFixed(0)} day(s) apart`}
                    {c.amountDelta > 0 && ` · amount differs by ${c.amountDelta.toFixed(2)}`}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => void act(c, "dismiss")} disabled={acting === c.outgoingId}>
                      <X className="h-4 w-4" /> Not a transfer
                    </Button>
                    <Button size="sm" onClick={() => void act(c, "confirm")} disabled={acting === c.outgoingId}>
                      <Check className="h-4 w-4" /> Confirm transfer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, account, row, currency }: { label: string; account: string; row: TransactionRow; currency: string }) {
  const amount = row.debit ?? row.credit ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{account}</span>
          <span className="text-xs text-muted-foreground">{row.date ?? row.raw_date}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{row.description}</p>
      </div>
      <div className="font-medium tabular-nums">{formatMoney(amount, currency)}</div>
    </div>
  );
}
