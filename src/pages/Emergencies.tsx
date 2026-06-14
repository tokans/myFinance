import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LifeBuoy, AlertTriangle, Pencil, ShieldCheck, PhoneOff } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmergencyActionButton } from "@/components/emergency/EmergencyActionButton";
import { isTauri } from "@/lib/environment";
import { accountTypeLabel } from "@/lib/accountTypes";
import { EMERGENCY_DISCLAIMER, hasActionableContact, mentionsContact } from "@/lib/emergency";
import { listAccounts, type Account } from "@/db/accounts";

export function EmergenciesPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setAccounts(await listAccounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const prepared = accounts.filter((a) => a.emergency_action?.trim() || a.contact?.trim());
  const unprepared = accounts.filter((a) => !a.emergency_action?.trim() && !a.contact?.trim());
  const needsContact = prepared.filter((a) => mentionsContact(a.emergency_action) && !a.contact?.trim());

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-destructive/10 p-2 text-destructive">
          <LifeBuoy className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Prepare for Emergencies</h2>
          <p className="text-sm text-muted-foreground">
            Record what your family should do — and who to call — for each account, so they can act
            during a hospitalisation, incapacity, or loss.
          </p>
        </div>
      </header>

      {/* Required disclaimer, always visible. */}
      <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:border-amber-700/50 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-2 py-3 text-xs leading-snug text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{EMERGENCY_DISCLAIMER}</span>
        </CardContent>
      </Card>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Accounts are stored in SQLite, which only runs inside the desktop/mobile app. Start with{" "}
            <code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code>.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium">No accounts yet</p>
            <p className="text-xs text-muted-foreground">
              Add accounts first, then record an emergency action and contact for each.
            </p>
            <Button asChild>
              <Link to="/accounts">Go to accounts</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary counters. */}
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <Stat icon={ShieldCheck} label="Prepared" value={prepared.length} tone="ok" />
            <Stat icon={PhoneOff} label="Need a contact" value={needsContact.length} tone="warn" />
            <Stat icon={AlertTriangle} label="Not yet prepared" value={unprepared.length} tone="muted" />
          </div>

          {prepared.length > 0 && (
            <section className="mb-6 space-y-2" data-testid="emergencies-prepared">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Emergency-ready accounts
              </h3>
              {prepared.map((a) => (
                <PreparedRow key={a.id} account={a} />
              ))}
            </section>
          )}

          {unprepared.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Not yet prepared
              </h3>
              <Card>
                <CardContent className="py-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    These accounts have no emergency action or contact. Open an account to add one.
                  </p>
                  <ul className="divide-y rounded-md border bg-card text-sm">
                    {unprepared.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{a.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {a.type === "other" && a.type_note ? a.type_note : accountTypeLabel(a.type)}
                          </span>
                        </span>
                        <Button asChild variant="ghost" size="sm">
                          <Link to="/accounts" aria-label={`Edit ${a.name}`}>
                            <Pencil className="h-3.5 w-3.5" /> Add
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PreparedRow({ account }: { account: Account }) {
  const wantsContact = mentionsContact(account.emergency_action) && !account.contact?.trim();
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/accounts/${account.id}`} className="font-medium hover:underline">
              {account.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              {account.type === "other" && account.type_note ? account.type_note : accountTypeLabel(account.type)}
              {account.institution ? ` · ${account.institution}` : ""}
            </p>
          </div>
          {hasActionableContact(account) && (
            <EmergencyActionButton account={account} size="sm" className="shrink-0" />
          )}
        </div>

        {account.emergency_action?.trim() && (
          <p className="whitespace-pre-wrap text-sm">{account.emergency_action}</p>
        )}
        {account.contact?.trim() && (
          <p className="text-xs text-muted-foreground">
            Contact: <span className="text-foreground">{account.contact}</span>
          </p>
        )}

        {wantsContact && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <PhoneOff className="h-3.5 w-3.5" />
            This action mentions contacting someone — <Link to="/accounts" className="underline">add a contact</Link> to
            enable the "Press during Emergency" button.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: number;
  tone: "ok" | "warn" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-0.5 py-3">
        <Icon className={`h-4 w-4 ${toneClass}`} />
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}
