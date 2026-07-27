import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, AlertCircle, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { DesktopOnlyNotice } from "@/components/layout/DesktopOnlyNotice";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { listSftForAy } from "@/db/aisSft";
import { listAllTransactions } from "@/db/transactions";
import { listAccounts, type Account } from "@/db/accounts";
import { crossCheckSft, type SftCrossCheckResult } from "@/domain/sftCrossCheck";

/**
 * Cross-checks AIS SFT rows (large-value transactions banks/registrars report
 * to the tax department) against this app's own bank transaction ledger.
 * Desktop-only, like the rest of the transaction ledger it depends on.
 * Purely informational — entity-name matching is inherently fuzzy, so this
 * never blocks or edits saved tax figures (see domain/sftCrossCheck.ts).
 */
export function SftCrossCheckPage() {
  const { ay = "" } = useParams<{ ay: string }>();
  const isDesktop = useIsDesktop();
  const currency = useSettingsStore((s) => s.settings.currency);
  const [results, setResults] = useState<SftCrossCheckResult[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTauri() || !isDesktop) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [sftRows, txns, accts] = await Promise.all([
        listSftForAy(ay),
        listAllTransactions(),
        listAccounts({ includeArchived: true }),
      ]);
      if (cancelled) return;
      const institutionByAccount = new Map(accts.map((a) => [a.id, a.institution]));
      const bankTxns = txns.map((t) => ({
        id: t.id,
        accountId: t.account_id,
        institution: institutionByAccount.get(t.account_id) ?? null,
        debit: t.debit,
        credit: t.credit,
      }));
      setResults(
        crossCheckSft(
          sftRows.map((r) => ({ sftCode: r.sft_code ?? "", description: r.description, reportingEntity: r.reporting_entity, amount: r.amount })),
          bankTxns,
        ),
      );
      setAccounts(accts);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ay, isDesktop]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  if (!isTauri()) {
    return (
      <div className="container max-w-3xl py-6">
        <PageHeader backTo={`/tax/${encodeURIComponent(ay)}`} backLabel="Back to tax year" title="SFT cross-check" />
        <DesktopOnlyNotice feature="The transaction ledger" />
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6">
      <PageHeader
        backTo={`/tax/${encodeURIComponent(ay)}`}
        backLabel="Back to tax year"
        title="SFT cross-check"
        description="Large-value transactions reported to the tax department vs. what shows up in your own bank ledger — informational only, entity-name matching here is inherently fuzzy."
      />

      {!isDesktop ? (
        <DesktopOnlyNotice feature="The transaction ledger" />
      ) : loading ? (
        <div className="py-6 text-sm text-muted-foreground">Loading…</div>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No SFT records for this assessment year yet — import your AIS/TIS JSON to see them here.
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {results.map((r, i) => (
            <li key={i} className="space-y-1 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-medium">{r.sftRow.description}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.sftRow.sftCode}</span>
                  {r.sftRow.reportingEntity && (
                    <span className="ml-2 text-xs text-muted-foreground">· {r.sftRow.reportingEntity}</span>
                  )}
                </div>
                <StatusChip status={r.status} />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>Reported: {formatMoney(r.sftRow.amount, currency)}</span>
                <span>Bank total: {formatMoney(r.bankTotal, currency)}</span>
                {r.matchedAccountIds.length > 0 && (
                  <span>
                    {r.matchedAccountIds.map((id) => accountById.get(id)?.name ?? `Account ${id}`).join(", ")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: SftCrossCheckResult["status"] }) {
  if (status === "reconciled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        <Check className="h-3 w-3" /> Reconciled
      </span>
    );
  }
  if (status === "no_data") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <HelpCircle className="h-3 w-3" /> No matching account found
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <AlertCircle className="h-3 w-3" /> {status === "higher_in_bank" ? "Bank shows more" : "Bank shows less"}
    </span>
  );
}
