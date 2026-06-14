import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Plus, Trash2, ShieldCheck, CalendarCheck, FileLock2, History } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { isTauri } from "@/lib/environment";
import { todayISO } from "@/lib/format";
import { ACCESS_TIERS, accessTierLabel } from "@/lib/accessTiers";
import { daysSinceCheckin, isCheckinStale } from "@/domain/access";
import { gatherSnapshot } from "@/lib/estateSnapshot";
import {
  createFinanceBreakGlassContributor, buildFinanceSnapshot, sealRecipientSlice,
  tierLabelForAccessTier,
} from "@/domain/breakGlassContributor";
import { useSettingsStore } from "@/stores/settings.store";
import { getSetting, setSetting } from "@/db/settings";
import { listPeople, type Person } from "@/db/people";
import {
  addGrant, clearAllGrants, deleteGrant, listAudit, listGrants, logAudit,
  type AccessGrantWithPerson, type AuditEntry,
} from "@/db/access";
import type { AccessTier } from "@/db/people";
import { DangerZone } from "@/components/common/DangerZone";

export function AccessPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const today = todayISO();
  const [people, setPeople] = useState<Person[]>([]);
  const [grants, setGrants] = useState<AccessGrantWithPerson[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [lastCheckin, setLastCheckin] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [personId, setPersonId] = useState("");
  const [tier, setTier] = useState<AccessTier>(1);
  const [scope, setScope] = useState("");

  const [exportTier, setExportTier] = useState<AccessTier>(2);
  const [passphrase, setPassphrase] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [ppl, gr, au, ci] = await Promise.all([
        listPeople(), listGrants(), listAudit(), getSetting("last_checkin"),
      ]);
      setPeople(ppl); setGrants(gr); setAudit(au); setLastCheckin(ci);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const checkIn = async () => {
    await setSetting("last_checkin", today);
    await logAudit("checkin", today);
    await refresh();
  };

  const add = async () => {
    if (!personId) return;
    await addGrant(Number(personId), tier, scope || null);
    setPersonId(""); setScope(""); setTier(1);
    await refresh();
  };

  const exportPackage = async () => {
    if (passphrase.length < 6) { setError("Use a passphrase of at least 6 characters."); return; }
    setExporting(true);
    setError(null);
    setExportNote(null);
    try {
      // Route the Tier-N access package through the CORE break-glass path (#10 cutover):
      // assemble myFinance's contributor, tier-filter to the recipient's tier, and seal a
      // zero-knowledge recipient slice the FREE standalone reader opens with the passphrase
      // only. Byte-parity with the retired redactForTier path is proven in
      // domain/breakGlassParity.test.ts.
      const snap = await gatherSnapshot(today, currency);
      const contributor = createFinanceBreakGlassContributor(snap);
      const bgSnapshot = await buildFinanceSnapshot([contributor], tierLabelForAccessTier(exportTier));
      const { blob: sealed } = await sealRecipientSlice(bgSnapshot, passphrase);
      const filename = `estate-package-tier${exportTier}-${today}.enc`;
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        const path = await save({ defaultPath: filename });
        if (path) {
          await writeFile(path, sealed);
          await logAudit("export_package", `tier ${exportTier}`);
          setExportNote("Encrypted package saved. Share the passphrase separately.");
        }
      } else {
        const url = URL.createObjectURL(new Blob([sealed as BlobPart]));
        const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
      setPassphrase("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const since = daysSinceCheckin(lastCheckin, today);
  const stale = isCheckinStale(lastCheckin, today);

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><KeyRound className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Trusted contacts & access</h2>
          <p className="text-sm text-muted-foreground">Tiered access, a local check-in, and encrypted handover packages.</p>
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
        <div className="space-y-6">
          {/* Check-in */}
          <Card className={stale ? "border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/20" : undefined}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="text-sm">
                <p className="font-medium">Check-in</p>
                <p className="text-xs text-muted-foreground">
                  {since == null ? "No check-in recorded yet." : `Last check-in ${since} day${since === 1 ? "" : "s"} ago.`}
                  {stale && " This is stale — review your plan and check in."}
                </p>
              </div>
              <Button onClick={checkIn} disabled={!isTauri()}><CalendarCheck className="h-4 w-4" /> I'm OK — check in</Button>
            </CardContent>
          </Card>

          {/* Grants */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Access grants</h3>
            {people.length === 0 ? (
              <Card><CardContent className="py-4 text-center text-sm text-muted-foreground">
                Add people first. <Link to="/people" className="underline">Go to People</Link>
              </CardContent></Card>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
                  <Select value={personId} onValueChange={setPersonId}>
                    <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Person…" /></SelectTrigger>
                    <SelectContent>{people.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={String(tier)} onValueChange={(v) => setTier(Number(v) as AccessTier)}>
                    <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>{ACCESS_TIERS.map((t) => <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input className="h-9 w-48" placeholder="Scope (optional)" value={scope} onChange={(e) => setScope(e.target.value)} />
                  <Button size="sm" onClick={add} disabled={!personId}><Plus className="h-4 w-4" /> Grant</Button>
                </div>
                {grants.length > 0 && (
                  <ul className="divide-y rounded-md border bg-card text-sm">
                    {grants.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate">
                          {g.person_name}
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase text-primary">{accessTierLabel(g.tier)}</span>
                          {g.scope && <span className="ml-2 text-xs text-muted-foreground">{g.scope}</span>}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => { await deleteGrant(g.id); await refresh(); }} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* Encrypted package */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <FileLock2 className="h-4 w-4" /> Encrypted handover package
            </h3>
            <Card>
              <CardContent className="space-y-3 py-4">
                <p className="text-xs text-muted-foreground">
                  Exports a tier-appropriate snapshot, encrypted with a passphrase your contact opens on
                  their own device. Share the passphrase separately (never with the file).
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <Select value={String(exportTier)} onValueChange={(v) => setExportTier(Number(v) as AccessTier)}>
                    <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>{ACCESS_TIERS.map((t) => <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input className="h-9 w-56" type="password" placeholder="Passphrase (≥ 6 chars)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  <Button size="sm" onClick={exportPackage} disabled={exporting || !isTauri()}>
                    <ShieldCheck className="h-4 w-4" /> {exporting ? "Encrypting…" : "Export"}
                  </Button>
                </div>
                {exportNote && <p className="text-xs text-emerald-600 dark:text-emerald-400">{exportNote}</p>}
              </CardContent>
            </Card>
          </section>

          {/* Audit */}
          {audit.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <History className="h-4 w-4" /> Audit log
              </h3>
              <ul className="divide-y rounded-md border bg-card text-xs">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-3 py-1.5">
                    <span>{a.action}{a.detail ? ` · ${a.detail}` : ""}</span>
                    <span className="text-muted-foreground">{a.at}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <DangerZone
            onCleared={refresh}
            actions={[
              {
                id: "access",
                label: "Clear access grants",
                description: (
                  <>
                    <span className="font-medium text-foreground">Clear access grants</span> — removes all{" "}
                    {grants.length} grant{grants.length === 1 ? "" : "s"} and the access audit log. Your
                    people and check-in date are kept. This cannot be undone.
                  </>
                ),
                confirmPrompt: "Delete every access grant?",
                confirmLabel: "Yes, delete grants",
                count: grants.length,
                run: clearAllGrants,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
