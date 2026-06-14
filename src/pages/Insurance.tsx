import { useCallback, useEffect, useState } from "react";
import { Shield, Plus, Pencil, Trash2, Check, AlertTriangle } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { assessCoverage, POLICY_KINDS, policyKindLabel, type PolicyKind } from "@/domain/insurance";
import { getNumberSetting, setSetting } from "@/db/settings";
import { latestSnapshotPerAccount } from "@/db/aggregates";
import { accountTypeKind } from "@/lib/accountTypes";
import {
  clearAllPolicies, createPolicy, deletePolicy, listPolicies, updatePolicy,
  type InsurancePolicy, type InsurancePolicyInput,
} from "@/db/insurance";
import { DangerZone } from "@/components/common/DangerZone";

export function InsurancePage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [income, setIncome] = useState("");
  const [healthTarget, setHealthTarget] = useState("");
  const [outstandingLoans, setOutstandingLoans] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InsurancePolicy | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [pol, inc, ht, latest] = await Promise.all([
        listPolicies(),
        getNumberSetting("annual_income"),
        getNumberSetting("health_target"),
        latestSnapshotPerAccount(),
      ]);
      setPolicies(pol);
      setIncome(inc != null ? String(inc) : "");
      setHealthTarget(ht != null ? String(ht) : "");
      const loans = latest
        .filter((l) => accountTypeKind(l.account_type) === "liability")
        .reduce((s, l) => s + (l.value || 0), 0);
      setOutstandingLoans(loans);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveTargets = async () => {
    await setSetting("annual_income", income.trim());
    await setSetting("health_target", healthTarget.trim());
    await refresh();
  };

  const lines = assessCoverage(policies, {
    annualIncome: Number(income) || 0,
    healthTarget: Number(healthTarget) || 0,
    outstandingLoans,
  });

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary"><Shield className="h-6 w-6" /></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Insurance</h2>
            <p className="text-sm text-muted-foreground">Coverage adequacy, renewals, and claims contacts.</p>
          </div>
        </div>
        <Button data-testid="insurance-add-policy" onClick={() => { setAdding(true); setEditing(null); }} disabled={!isTauri()}>
          <Plus className="h-4 w-4" /> Add policy
        </Button>
      </header>

      <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:border-amber-700/50 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-2 py-3 text-xs leading-snug text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Coverage targets are rules of thumb, not personalised financial advice. Review with a qualified advisor.</span>
        </CardContent>
      </Card>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Stored in SQLite — open the desktop/mobile app.
          </CardContent>
        </Card>
      )}
      {error && <Card className="mb-4 border-destructive/60"><CardContent className="py-3 text-xs text-destructive">{error}</CardContent></Card>}

      {/* Coverage adequacy */}
      <section className="mb-6 space-y-3">
        <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Annual income ({currency})</Label>
            <Input data-testid="insurance-income" type="number" value={income} onChange={(e) => setIncome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Health cover target ({currency})</Label>
            <Input data-testid="insurance-health-target" type="number" value={healthTarget} onChange={(e) => setHealthTarget(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button data-testid="insurance-save-targets" variant="outline" onClick={saveTargets} disabled={!isTauri()}>Save targets</Button>
          </div>
        </div>

        {lines.length > 0 && (
          <ul className="space-y-2" data-testid="insurance-coverage">
            {lines.map((l) => (
              <li key={l.kind}>
                <Card className={l.adequate ? "border-emerald-300/50" : "border-amber-300/60"}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {l.adequate ? <Check className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                      {l.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      covered {formatMoney(l.covered, currency)} / target {formatMoney(l.target, currency)}
                      {l.gap > 0 && <strong className="ml-2 text-amber-700 dark:text-amber-400">gap {formatMoney(l.gap, currency)}</strong>}
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {outstandingLoans > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Loan-protection target uses your current outstanding liabilities ({formatMoney(outstandingLoans, currency)}, from account balances).
          </p>
        )}
      </section>

      {/* Policies */}
      {adding && (
        <div className="mb-4">
          <PolicyForm
            currency={currency}
            onSubmit={async (i) => { await createPolicy(i); setAdding(false); await refresh(); }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : policies.length === 0 && !adding ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No policies yet.</CardContent></Card>
      ) : (
        <ul className="space-y-2">
          {policies.map((p) =>
            editing?.id === p.id ? (
              <li key={p.id}>
                <PolicyForm
                  currency={currency}
                  initial={p}
                  onSubmit={async (i) => { await updatePolicy(p.id, i); setEditing(null); await refresh(); }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={p.id}>
                <Card>
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{p.insurer}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{policyKindLabel(p.kind)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Sum assured {formatMoney(p.sum_assured, currency)}
                        {p.renewal_date ? ` · renews ${p.renewal_date}` : ""}
                        {p.policy_no ? ` · ${p.policy_no}` : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setAdding(false); }} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={async () => { await deletePolicy(p.id); await refresh(); }} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                  </CardContent>
                </Card>
              </li>
            ),
          )}
        </ul>
      )}

      <DangerZone
        onCleared={refresh}
        actions={[
          {
            id: "insurance",
            label: "Clear policies",
            description: (
              <>
                <span className="font-medium text-foreground">Clear policies</span> — deletes all{" "}
                {policies.length} insurance polic{policies.length === 1 ? "y" : "ies"}. Your income and
                cover-target settings are kept. This cannot be undone.
              </>
            ),
            confirmPrompt: "Delete every policy?",
            confirmLabel: "Yes, delete policies",
            count: policies.length,
            run: clearAllPolicies,
          },
        ]}
      />
    </div>
  );
}

function PolicyForm({
  currency, initial, onSubmit, onCancel,
}: {
  currency: string;
  initial?: InsurancePolicy;
  onSubmit: (input: InsurancePolicyInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PolicyKind>(initial?.kind ?? "term");
  const [insurer, setInsurer] = useState(initial?.insurer ?? "");
  const [policyNo, setPolicyNo] = useState(initial?.policy_no ?? "");
  const [sumAssured, setSumAssured] = useState(String(initial?.sum_assured ?? ""));
  const [renewal, setRenewal] = useState(initial?.renewal_date ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!insurer.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        kind, insurer, policy_no: policyNo || null,
        sum_assured: Number(sumAssured) || 0, renewal_date: renewal || null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as PolicyKind)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {POLICY_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label className="text-xs">Insurer</Label><Input data-testid="policy-form-insurer" value={insurer} onChange={(e) => setInsurer(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Policy number</Label><Input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Sum assured ({currency})</Label><Input data-testid="policy-form-sum" type="number" value={sumAssured} onChange={(e) => setSumAssured(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Renewal date</Label><Input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" data-testid="policy-form-submit" onClick={submit} disabled={busy || !insurer.trim()}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}
