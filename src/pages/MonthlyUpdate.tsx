import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, SkipForward, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/environment";
import { currentMonth, formatMoney, formatMonthLabel } from "@/lib/format";
import { listAccounts, type Account } from "@/db/accounts";
import { listSnapshotsForMonth, upsertSnapshot } from "@/db/snapshots";
import { latestSnapshotPerAccount } from "@/db/aggregates";
import { accountTypeLabel } from "@/lib/accountTypes";

type Stage = "setup" | "wizard" | "done";

interface PriorEntry {
  month: string;
  value: number;
}

interface EntryResult {
  status: "saved" | "skipped";
  value?: number;
  note?: string;
  /** Previously stored value for this month, if any (so we can show "updated" vs "new"). */
  previousForMonth?: number;
}

export function MonthlyUpdatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [stage, setStage] = useState<Stage>("setup");
  const [month, setMonth] = useState<string>(params.get("month") ?? currentMonth());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [prior, setPrior] = useState<Map<number, PriorEntry>>(new Map());
  const [thisMonth, setThisMonth] = useState<Map<number, number>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [entries, setEntries] = useState<Map<number, EntryResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Per-step form
  const [valueInput, setValueInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadAccounts = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const accs = await listAccounts({ includeArchived: false });
      setAccounts(accs);
      const latest = await latestSnapshotPerAccount();
      const lmap = new Map<number, PriorEntry>();
      for (const r of latest) lmap.set(r.account_id, { month: r.month, value: r.value });
      setPrior(lmap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const startWizard = async () => {
    setError(null);
    setBusy(true);
    try {
      const snaps = await listSnapshotsForMonth(month);
      const tm = new Map<number, number>();
      for (const s of snaps) tm.set(s.account_id, s.value);
      setThisMonth(tm);
      setEntries(new Map());
      setCurrentIdx(0);
      setStage("wizard");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Prefill the form when we land on a new account.
  useEffect(() => {
    if (stage !== "wizard") return;
    const acc = accounts[currentIdx];
    if (!acc) return;
    const existing = entries.get(acc.id);
    const inMonth = thisMonth.get(acc.id);
    const last = prior.get(acc.id);
    const initial =
      existing?.value != null ? String(existing.value)
      : inMonth != null ? String(inMonth)
      : last ? String(last.value)
      : "";
    setValueInput(initial);
    setNoteInput(existing?.note ?? "");
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, currentIdx, accounts]);

  const acc = accounts[currentIdx];
  const last = acc ? prior.get(acc.id) : undefined;
  const existingInMonth = acc ? thisMonth.get(acc.id) : undefined;

  const progressPct = accounts.length
    ? Math.round((entries.size / accounts.length) * 100)
    : 0;

  const advance = () => {
    if (currentIdx + 1 < accounts.length) setCurrentIdx((i) => i + 1);
    else setStage("done");
  };

  const saveAndNext = async () => {
    if (!acc) return;
    const value = Number(valueInput);
    if (!Number.isFinite(value)) {
      setError("Enter a number for the value.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await upsertSnapshot({
        account_id: acc.id,
        month,
        value,
        note: noteInput.trim() || null,
        source: "manual",
      });
      setEntries((prev) => {
        const next = new Map(prev);
        next.set(acc.id, {
          status: "saved", value, note: noteInput.trim() || undefined,
          previousForMonth: existingInMonth,
        });
        return next;
      });
      // Refresh in-month map so going back shows the new value as "already in this month".
      setThisMonth((prev) => new Map(prev).set(acc.id, value));
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const skipAndNext = () => {
    if (!acc) return;
    setEntries((prev) => {
      const next = new Map(prev);
      next.set(acc.id, { status: "skipped" });
      return next;
    });
    advance();
  };

  const goBack = () => {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
  };

  const copyLast = () => {
    if (last) setValueInput(String(last.value));
  };

  const handleKey: React.KeyboardEventHandler = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void saveAndNext();
    }
  };

  const stats = useMemo(() => {
    let saved = 0, skipped = 0;
    for (const e of entries.values()) {
      if (e.status === "saved") saved++;
      else if (e.status === "skipped") skipped++;
    }
    return { saved, skipped };
  }, [entries]);

  // -------- Render --------

  if (!isTauri()) {
    return (
      <div className="container max-w-2xl py-6">
        <h2 className="text-2xl font-semibold tracking-tight">Monthly update</h2>
        <Card className="mt-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Run in the desktop app to use the monthly update wizard.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="container py-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className="container max-w-2xl py-6">
        <h2 className="text-2xl font-semibold tracking-tight">Monthly update</h2>
        <Card className="mt-4">
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm">You don&apos;t have any active accounts yet.</p>
            <Button asChild size="sm"><Link to="/accounts">Add an account</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (stage === "setup") {
    return (
      <div className="container max-w-2xl py-6">
        <header className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">Monthly update</h2>
          <p className="text-sm text-muted-foreground">
            Enter this month&apos;s value for each of your {accounts.length} active account{accounts.length === 1 ? "" : "s"}, one at a time.
          </p>
        </header>

        {error && (
          <Card className="mb-4 border-destructive/60">
            <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="space-y-1.5 max-w-xs">
              <Label htmlFor="upd-month">Month</Label>
              <Input
                id="upd-month"
                data-testid="update-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to the current month. Entering the same month again overwrites.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button data-testid="update-start" onClick={() => void startWizard()} disabled={busy}>
                {busy ? "Preparing…" : "Start"}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (stage === "wizard" && acc) {
    return (
      <div className="container max-w-2xl py-6">
        <header className="mb-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setStage("setup")} className="-ml-2">
            <ChevronLeft className="h-4 w-4" /> Setup
          </Button>
          <div className="ml-auto text-xs text-muted-foreground tabular-nums">
            Account {currentIdx + 1} of {accounts.length} · {formatMonthLabel(month)}
          </div>
        </header>

        <div className="mb-4 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>

        {error && (
          <Card className="mb-4 border-destructive/60">
            <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-5 py-6">
            <div className="flex items-baseline gap-2">
              <h3 className="text-xl font-semibold">{acc.name}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {accountTypeLabel(acc.type)}
              </span>
            </div>
            <p className="-mt-3 text-xs text-muted-foreground">
              {acc.institution ?? "no institution"}
            </p>

            <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              {existingInMonth != null && (
                <p>
                  <strong>Already saved this month:</strong>{" "}
                  <span className="tabular-nums">{formatMoney(existingInMonth, acc.currency)}</span>
                  <span className="text-muted-foreground"> (saving will overwrite)</span>
                </p>
              )}
              {last ? (
                <p>
                  <strong>Last entered:</strong>{" "}
                  <span className="tabular-nums">{formatMoney(last.value, acc.currency)}</span>{" "}
                  in {formatMonthLabel(last.month)}
                </p>
              ) : (
                <p className="text-muted-foreground">No prior snapshots for this account.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="upd-value">Value ({acc.currency})</Label>
              <Input
                id="upd-value"
                data-testid="update-value"
                ref={inputRef}
                type="number"
                step="0.01"
                inputMode="decimal"
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
                onKeyDown={handleKey}
                className="h-12 text-xl tabular-nums"
              />
              {last && (
                <Button type="button" variant="ghost" size="sm" onClick={copyLast} className="-ml-2">
                  <Sparkles className="h-3.5 w-3.5" /> Same as last ({formatMoney(last.value, acc.currency)})
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="upd-note">Note <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="upd-note"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button variant="ghost" onClick={goBack} disabled={currentIdx === 0 || busy}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={skipAndNext} disabled={busy}>
                  <SkipForward className="h-4 w-4" /> Skip
                </Button>
                <Button data-testid="update-save" onClick={() => void saveAndNext()} disabled={busy || !valueInput.trim()}>
                  {busy
                    ? "Saving…"
                    : currentIdx + 1 === accounts.length
                      ? <>Save & finish <Check className="h-4 w-4" /></>
                      : <>Save & next <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-3 text-center text-xs text-muted-foreground">
          <button data-testid="update-finish" onClick={() => setStage("done")} className="underline hover:text-foreground">
            Finish now and see summary
          </button>
        </div>
      </div>
    );
  }

  // Done stage
  return (
    <div className="container max-w-2xl py-6">
      <header className="mb-6">
        <h2 data-testid="update-done" className="text-2xl font-semibold tracking-tight">All done</h2>
        <p className="text-sm text-muted-foreground">
          {formatMonthLabel(month)} · {stats.saved} saved · {stats.skipped} skipped · {accounts.length - stats.saved - stats.skipped} unvisited
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {accounts.map((a) => {
              const e = entries.get(a.id);
              return (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{accountTypeLabel(a.type)}</p>
                  </div>
                  {e?.status === "saved" && (
                    <>
                      <span className="text-xs text-emerald-700 dark:text-emerald-400">
                        {e.previousForMonth != null ? "updated" : "saved"}
                      </span>
                      <span className="w-32 text-right font-medium tabular-nums">
                        {formatMoney(e.value!, a.currency)}
                      </span>
                    </>
                  )}
                  {e?.status === "skipped" && (
                    <span className="text-xs text-muted-foreground">skipped</span>
                  )}
                  {!e && (
                    <span className="text-xs text-muted-foreground">not visited</span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="mt-4 flex gap-2">
        <Button onClick={() => setStage("setup")}>Update another month</Button>
        <Button variant="ghost" asChild><Link to="/">Back to dashboard</Link></Button>
      </div>
    </div>
  );
}
