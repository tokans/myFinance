import { useCallback, useEffect, useState } from "react";
import { ScrollText, Save, AlertTriangle, Check, FileDown } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DocumentAttach } from "@/components/documents/DocumentAttach";
import { isTauri } from "@/lib/environment";
import { buildSimpleWill, reconcileWillVsNominees, type ReconcileRow } from "@/domain/will";
import { clearWillMeta, getWillMeta, upsertWillMeta, type WillMetaInput } from "@/db/will";
import { listPeople, type Person } from "@/db/people";
import { listAccounts, type Account } from "@/db/accounts";
import { listHoldingsWithPeople } from "@/db/holdings";
import { DangerZone } from "@/components/common/DangerZone";

export function WillPage() {
  const [meta, setMeta] = useState<WillMetaInput>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recon, setRecon] = useState<ReconcileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [hasMeta, setHasMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [m, ppl, accts, holdings] = await Promise.all([
        getWillMeta(), listPeople(), listAccounts(), listHoldingsWithPeople(),
      ]);
      setHasMeta(!!m);
      if (m) {
        setMeta({
          has_will: m.has_will === 1,
          executor_person_id: m.executor_person_id,
          guardian_person_id: m.guardian_person_id,
          registered: m.registered === 1,
          registration_details: m.registration_details ?? "",
          location_of_original: m.location_of_original ?? "",
          probate_required: m.probate_required === 1,
          notes: m.notes ?? "",
        });
      }
      setPeople(ppl);
      setAccounts(accts);
      setRecon(reconcileWillVsNominees(holdings));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const set = <K extends keyof WillMetaInput>(k: K, v: WillMetaInput[K]) => {
    setMeta((m) => ({ ...m, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setError(null);
    try { await upsertWillMeta(meta); setHasMeta(true); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `#${id}`;
  const mismatches = recon.filter((r) => !r.matches);

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><ScrollText className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Will & legal vault</h2>
          <p className="text-sm text-muted-foreground">Store and version your Will; reconcile it against nominees.</p>
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
          {/* Will details */}
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!meta.has_will} onChange={(e) => set("has_will", e.target.checked)} />
              I have a Will
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <PersonSelect label="Executor" people={people} value={meta.executor_person_id ?? null} onChange={(v) => set("executor_person_id", v)} />
              <PersonSelect label="Guardian for minors" people={people} value={meta.guardian_person_id ?? null} onChange={(v) => set("guardian_person_id", v)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs">Registration details</Label><Input value={meta.registration_details ?? ""} onChange={(e) => set("registration_details", e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Location of original</Label><Input value={meta.location_of_original ?? ""} onChange={(e) => set("location_of_original", e.target.value)} placeholder="e.g. Bank locker" /></div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!meta.registered} onChange={(e) => set("registered", e.target.checked)} /> Registered</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!meta.probate_required} onChange={(e) => set("probate_required", e.target.checked)} /> Probate required (Mumbai/Kolkata/Chennai OCJ)</label>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={!isTauri()}><Save className="h-4 w-4" /> Save</Button>
              {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
            </div>
          </section>

          {/* Reconciliation */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Will vs nominee reconciliation</h3>
            {recon.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No accounts have both a nominee and a Will beneficiary yet. Assign beneficiaries as
                holdings (role “beneficiary”) on the Nominees data to compare.
              </p>
            ) : mismatches.length === 0 ? (
              <Card className="border-emerald-300/50">
                <CardContent className="flex items-center gap-2 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                  <Check className="h-4 w-4" /> All {recon.length} reconciled account(s) match.
                </CardContent>
              </Card>
            ) : (
              <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/20">
                <CardContent className="py-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4" /> {mismatches.length} mismatch(es): nominee ≠ Will beneficiary
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                    {mismatches.map((r) => <li key={r.account_id}>{accountName(r.account_id)}</li>)}
                  </ul>
                </CardContent>
              </Card>
            )}
          </section>

          {/* Documents */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Will documents</h3>
            <DocumentAttach types={["will", "codicil", "probate"]} />
          </section>

          {/* Template */}
          <WillTemplate people={people} />

          <DangerZone
            onCleared={() => { setMeta({}); setHasMeta(false); setSaved(false); }}
            actions={[
              {
                id: "will",
                label: "Clear Will details",
                description: (
                  <>
                    <span className="font-medium text-foreground">Clear Will details</span> — deletes
                    the executor, guardian, registration and location details saved here. Attached Will
                    documents and people are kept. This cannot be undone.
                  </>
                ),
                confirmPrompt: "Delete the Will details?",
                confirmLabel: "Yes, delete details",
                count: hasMeta ? 1 : 0,
                run: clearWillMeta,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function PersonSelect({ label, people, value, onChange }: {
  label: string; people: Person[]; value: number | null; onChange: (v: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value != null ? String(value) : ""} onValueChange={(v) => onChange(v === "none" ? null : Number(v))}>
        <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          {people.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function WillTemplate({ people }: { people: Person[] }) {
  const [testator, setTestator] = useState("");
  const [place, setPlace] = useState("");
  const [executor, setExecutor] = useState("");
  const [residuary, setResiduary] = useState("");
  const [text, setText] = useState("");

  void people;
  const generate = () => {
    setText(buildSimpleWill({
      testatorName: testator, place, executorName: executor, residuaryTo: residuary,
    }));
  };

  const exportText = async () => {
    if (!text) return;
    try {
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const path = await save({ defaultPath: "draft-will.txt" });
        if (path) await writeTextFile(path, text);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        const a = document.createElement("a"); a.href = url; a.download = "draft-will.txt"; a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Simple Will template</h3>
      <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/20">
        <CardContent className="py-2.5 text-xs text-amber-900 dark:text-amber-200">
          A basic template only — not legal advice. Complex estates need a lawyer for validity,
          registration, and witnessing.
        </CardContent>
      </Card>
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label className="text-xs">Your full name</Label><Input value={testator} onChange={(e) => setTestator(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Place</Label><Input value={place} onChange={(e) => setPlace(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Executor name</Label><Input value={executor} onChange={(e) => setExecutor(e.target.value)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">Residuary estate to</Label><Input value={residuary} onChange={(e) => setResiduary(e.target.value)} /></div>
        <div className="sm:col-span-2 flex gap-2">
          <Button size="sm" onClick={generate}>Generate</Button>
          {text && <Button size="sm" variant="outline" onClick={exportText}><FileDown className="h-4 w-4" /> Export</Button>}
        </div>
      </div>
      {text && <Textarea className="min-h-[220px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />}
    </section>
  );
}
