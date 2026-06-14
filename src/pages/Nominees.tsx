import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users2, AlertTriangle, Plus, Trash2, Check } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { accountTypeLabel } from "@/lib/accountTypes";
import {
  accountIdsWithoutNominee, exposureByPerson, nomineeShareSum, nomineeSharesValid,
} from "@/domain/nominations";
import { listAccounts, type Account } from "@/db/accounts";
import { listPeople, type Person } from "@/db/people";
import {
  addHolding, clearAllHoldings, deleteHolding, listHoldingsWithPeople, setHoldingMode,
  HOLDING_MODES, type HoldingMode, type HoldingWithPerson,
} from "@/db/holdings";
import { latestSnapshotPerAccount } from "@/db/aggregates";
import { DangerZone } from "@/components/common/DangerZone";

export function NomineesPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [holdings, setHoldings] = useState<HoldingWithPerson[]>([]);
  const [valueById, setValueById] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [accts, ppl, hold, latest] = await Promise.all([
        listAccounts(), listPeople(), listHoldingsWithPeople(), latestSnapshotPerAccount(),
      ]);
      setAccounts(accts);
      setPeople(ppl);
      setHoldings(hold);
      setValueById(new Map(latest.map((l) => [l.account_id, l.value])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const missing = accountIdsWithoutNominee(accounts.map((a) => a.id), holdings);
  const exposure = exposureByPerson(
    accounts.map((a) => ({ id: a.id, value: valueById.get(a.id) ?? 0 })),
    holdings,
  );
  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? `#${id}`;

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Users2 className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Nominees & beneficiaries</h2>
          <p className="text-sm text-muted-foreground">
            Nominees are custodians, not owners — gaps and mismatches cause real disputes.
          </p>
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">Stored in SQLite — open the desktop/mobile app.</CardContent>
        </Card>
      )}
      {error && <Card className="mb-4 border-destructive/60"><CardContent className="py-3 text-xs text-destructive">{error}</CardContent></Card>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : people.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            Add people first, then assign them as nominees here.
            <Button asChild size="sm" className="mt-1"><Link to="/people">Go to People</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Red flags */}
          {missing.length > 0 && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" /> {missing.length} account{missing.length === 1 ? "" : "s"} without a nominee
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {missing.map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean).join(", ")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Exposure by person */}
          {exposure.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Nominee exposure by person</h3>
              <ul className="divide-y rounded-md border bg-card text-sm">
                {exposure.map((e) => (
                  <li key={e.person_id} className="flex items-center justify-between px-3 py-2">
                    <span>{personName(e.person_id)} <span className="text-xs text-muted-foreground">· {e.accountCount} account{e.accountCount === 1 ? "" : "s"}</span></span>
                    <span className="tabular-nums">{formatMoney(e.total, currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Per-account nominee editors */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Per-account nominees</h3>
            {accounts.map((a) => (
              <AccountNominees
                key={a.id}
                account={a}
                people={people}
                holdings={holdings.filter((h) => h.account_id === a.id)}
                onAdd={(personId, share) => act(() => addHolding({ account_id: a.id, person_id: personId, role: "nominee", share_pct: share }))}
                onRemove={(id) => act(() => deleteHolding(id))}
                onMode={(mode) => act(() => setHoldingMode(a.id, mode))}
              />
            ))}
          </section>
        </div>
      )}

      <DangerZone
        onCleared={refresh}
        actions={[
          {
            id: "holdings",
            label: "Clear nominees",
            description: (
              <>
                <span className="font-medium text-foreground">Clear nominees</span> — removes all{" "}
                {holdings.length} nominee, co-holder and beneficiary assignment
                {holdings.length === 1 ? "" : "s"}. Your accounts and people are kept. This cannot be
                undone.
              </>
            ),
            confirmPrompt: "Delete every nominee assignment?",
            confirmLabel: "Yes, delete assignments",
            count: holdings.length,
            run: clearAllHoldings,
          },
        ]}
      />
    </div>
  );
}

function AccountNominees({
  account, people, holdings, onAdd, onRemove, onMode,
}: {
  account: Account;
  people: Person[];
  holdings: HoldingWithPerson[];
  onAdd: (personId: number, share: number | null) => void;
  onRemove: (id: number) => void;
  onMode: (mode: HoldingMode) => void;
}) {
  const [personId, setPersonId] = useState("");
  const [share, setShare] = useState("");
  const nominees = holdings.filter((h) => h.role === "nominee");
  const sum = nomineeShareSum(holdings, account.id);
  const valid = nomineeSharesValid(holdings, account.id);

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-medium">{account.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">{accountTypeLabel(account.type)}</span>
          </div>
          <Select value={account.holding_mode ?? ""} onValueChange={(v) => onMode(v as HoldingMode)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Holding mode" /></SelectTrigger>
            <SelectContent>
              {HOLDING_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {nominees.length > 0 ? (
          <ul className="divide-y rounded-md border text-sm">
            {nominees.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span>{h.person_name}{h.relationship ? ` (${h.relationship})` : ""}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{h.share_pct != null ? `${h.share_pct}%` : "—"}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemove(h.id)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No nominee assigned.</p>
        )}

        {nominees.length > 0 && (
          <p className={`flex items-center gap-1 text-xs ${valid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
            {valid ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Shares total {sum}%{valid ? "" : " — should be 100%"}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Select value={personId} onValueChange={setPersonId}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Add nominee…" /></SelectTrigger>
            <SelectContent>
              {people.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="h-8 w-24 text-xs" type="number" placeholder="Share %" value={share} onChange={(e) => setShare(e.target.value)} />
          <Button
            size="sm"
            disabled={!personId}
            onClick={() => { onAdd(Number(personId), share === "" ? null : Number(share)); setPersonId(""); setShare(""); }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
