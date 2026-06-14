import { useCallback, useEffect, useState } from "react";
import { Droplets, Save, AlertTriangle, Check } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/environment";
import { formatMoney } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { accountTypeKind } from "@/lib/accountTypes";
import {
  emergencyFundMonths, emergencyFundTarget, isEmergencyFundLow,
  liquidAssetsTotal, spouseOperableTotal, type LiquidAccount,
} from "@/domain/liquidity";
import { getNumberSetting, setSetting } from "@/db/settings";
import { listAccounts } from "@/db/accounts";
import { latestSnapshotPerAccount } from "@/db/aggregates";

export function LiquidityPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const [accounts, setAccounts] = useState<LiquidAccount[]>([]);
  const [expenses, setExpenses] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [accts, latest, exp] = await Promise.all([
        listAccounts(), latestSnapshotPerAccount(), getNumberSetting("household_monthly_expenses"),
      ]);
      const valueById = new Map(latest.map((l) => [l.account_id, l.value]));
      setAccounts(accts.map((a) => ({
        type: a.type,
        holding_mode: a.holding_mode,
        value: valueById.get(a.id) ?? 0,
        kind: accountTypeKind(a.type),
      })));
      setExpenses(exp != null ? String(exp) : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveExpenses = async () => {
    setError(null);
    try { await setSetting("household_monthly_expenses", expenses.trim()); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const monthly = Number(expenses) || 0;
  const liquid = liquidAssetsTotal(accounts);
  const operable = spouseOperableTotal(accounts);
  const months = emergencyFundMonths(liquid, monthly);
  const target = emergencyFundTarget(monthly);
  const low = isEmergencyFundLow(liquid, monthly);

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Droplets className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Joint holdings & liquidity</h2>
          <p className="text-sm text-muted-foreground">What a surviving partner can access, and your emergency fund.</p>
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
      ) : (
        <div className="space-y-5">
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">Spouse-operable liquidity</p>
                <p className="text-xs text-muted-foreground">Joint / either-or-survivor / former-or-survivor asset accounts.</p>
              </div>
              <span className="text-xl font-semibold tabular-nums">{formatMoney(operable, currency)}</span>
            </CardContent>
          </Card>

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Household monthly expenses ({currency})</Label>
                <Input type="number" value={expenses} onChange={(e) => { setExpenses(e.target.value); setSaved(false); }} className="w-44" />
              </div>
              <Button variant="outline" onClick={saveExpenses} disabled={!isTauri()}><Save className="h-4 w-4" /> Save</Button>
              {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
            </div>

            {monthly > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Liquid assets (savings / checking / cash)</span>
                  <span className="tabular-nums">{formatMoney(liquid, currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Emergency fund target (6 months)</span>
                  <span className="tabular-nums">{formatMoney(target, currency)}</span>
                </div>
                <div className={`flex items-center gap-2 rounded-md border p-2.5 text-sm ${low ? "border-amber-300/60 bg-amber-50/40 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300" : "border-emerald-300/50 text-emerald-700 dark:text-emerald-400"}`}>
                  {low ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  Liquid assets cover <strong>{months.toFixed(1)} months</strong> of expenses{low ? " — below the 6-month target." : "."}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Enter your monthly expenses to see emergency-fund coverage.</p>
            )}
          </section>
          <p className="text-[11px] text-muted-foreground">
            Set each account's holding mode on the Nominees page so survivor-operable liquidity is accurate.
          </p>
        </div>
      )}
    </div>
  );
}
