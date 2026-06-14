import { useCallback, useEffect, useState } from "react";
import { Database, FileDown, FileLock2, Search } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isTauri } from "@/lib/environment";
import { formatMoney, todayISO } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { gatherSnapshot } from "@/lib/estateSnapshot";
import { encryptJson } from "@/lib/packageCrypto";
import type { RegisterSnapshot } from "@/domain/registerSnapshot";

export function RegisterExportPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const [snapshot, setSnapshot] = useState<RegisterSnapshot | null>(null);
  const [q, setQ] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try { setSnapshot(await gatherSnapshot(todayISO(), currency)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [currency]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveBytes = async (bytes: Uint8Array | string, filename: string, mime = "application/json") => {
    if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({ defaultPath: filename });
      if (!path) return false;
      if (typeof bytes === "string") await writeTextFile(path, bytes);
      else await writeFile(path, bytes);
      return true;
    }
    const blob = typeof bytes === "string" ? new Blob([bytes], { type: mime }) : new Blob([bytes as BlobPart]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    return true;
  };

  const exportPlain = async () => {
    if (!snapshot) return;
    setNote(null); setError(null);
    try {
      const ok = await saveBytes(JSON.stringify(snapshot, null, 2), `register-${todayISO()}.json`);
      if (ok) setNote("Register exported as plain JSON. Keep it somewhere safe — it is unencrypted.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const exportEncrypted = async () => {
    if (!snapshot) return;
    if (passphrase.length < 6) { setError("Use a passphrase of at least 6 characters."); return; }
    setNote(null); setError(null);
    try {
      const sealed = await encryptJson(snapshot, passphrase);
      const ok = await saveBytes(sealed, `register-${todayISO()}.enc`);
      if (ok) { setNote("Register exported as an encrypted package. Store the passphrase separately."); setPassphrase(""); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const accounts = (snapshot?.accounts ?? []).filter((a) =>
    q.trim() === "" || `${a.name} ${a.type} ${a.institution ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Database className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Master register & export</h2>
          <p className="text-sm text-muted-foreground">Search all assets, and export the full register for backup or portability.</p>
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">Reads from SQLite — open the desktop/mobile app.</CardContent>
        </Card>
      )}
      {error && <Card className="mb-4 border-destructive/60"><CardContent className="py-3 text-xs text-destructive">{error}</CardContent></Card>}
      {note && <Card className="mb-4 border-sky-300/60 bg-sky-50/40 dark:bg-sky-950/20"><CardContent className="py-3 text-xs text-sky-900 dark:text-sky-200">{note}</CardContent></Card>}

      {/* Export */}
      <section className="mb-6 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">Encrypted package</p>
          <p className="text-xs text-muted-foreground">AES-256 with a passphrase — restorable on a fresh install.</p>
          <div className="flex gap-2">
            <Input className="h-9" type="password" placeholder="Passphrase (≥ 6)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            <Button size="sm" onClick={exportEncrypted} disabled={loading}><FileLock2 className="h-4 w-4" /> Export</Button>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Plain JSON</p>
          <p className="text-xs text-muted-foreground">Portable but unencrypted — handle with care.</p>
          <Button size="sm" variant="outline" onClick={exportPlain} disabled={loading}><FileDown className="h-4 w-4" /> Export JSON</Button>
        </div>
      </section>

      {/* Search */}
      <section className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search accounts…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y rounded-md border bg-card text-sm">
            {accounts.map((a, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {a.name}<span className="ml-2 text-xs text-muted-foreground">{a.type}{a.institution ? ` · ${a.institution}` : ""}</span>
                </span>
                <span className="tabular-nums">{a.value != null ? formatMoney(a.value, currency) : "—"}</span>
              </li>
            ))}
            {accounts.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">No matching accounts.</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
