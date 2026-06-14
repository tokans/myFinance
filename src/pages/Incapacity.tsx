import { useCallback, useEffect, useState } from "react";
import { ShieldHalf, Save, Info } from "lucide-react";
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
import { clearIncapacityMeta, getIncapacityMeta, upsertIncapacityMeta, type IncapacityMetaInput } from "@/db/incapacity";
import { listPeople, type Person } from "@/db/people";
import { DangerZone } from "@/components/common/DangerZone";

export function IncapacityPage() {
  const [m, setM] = useState<IncapacityMetaInput>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [hasMeta, setHasMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [meta, ppl] = await Promise.all([getIncapacityMeta(), listPeople()]);
      setHasMeta(!!meta);
      if (meta) {
        setM({
          poa_attorney_person_id: meta.poa_attorney_person_id,
          poa_kind: meta.poa_kind ?? "",
          poa_scope: meta.poa_scope ?? "",
          poa_registered: meta.poa_registered === 1,
          poa_revoked: meta.poa_revoked === 1,
          amd_life_support: meta.amd_life_support ?? "",
          amd_resuscitation: meta.amd_resuscitation ?? "",
          amd_organ_donation: meta.amd_organ_donation === 1,
          amd_attestation: meta.amd_attestation ?? "",
          notes: meta.notes ?? "",
        });
      }
      setPeople(ppl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const set = <K extends keyof IncapacityMetaInput>(k: K, v: IncapacityMetaInput[K]) => {
    setM((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setError(null);
    try { await upsertIncapacityMeta(m); setHasMeta(true); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><ShieldHalf className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Power of Attorney & incapacity</h2>
          <p className="text-sm text-muted-foreground">PoA, living will / advance medical directive, and guidance.</p>
        </div>
      </header>

      <Card className="mb-4 border-sky-300/60 bg-sky-50/40 dark:border-sky-800/40 dark:bg-sky-950/20">
        <CardContent className="flex items-start gap-2 py-3 text-xs leading-snug text-sky-900 dark:text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            In India a Power of Attorney generally lapses on the principal's mental incapacity — it is
            not a substitute for guardianship. For ongoing decisions during incapacity, the route is
            guardianship under the Mental Healthcare Act 2017. An Advance Medical Directive (per the
            Common Cause judgment) records treatment wishes and needs proper witnessing/attestation.
            This is general information, not legal advice.
          </span>
        </CardContent>
      </Card>

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
          {/* PoA */}
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold">Power of Attorney</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Attorney-in-fact</Label>
                <Select value={m.poa_attorney_person_id != null ? String(m.poa_attorney_person_id) : ""} onValueChange={(v) => set("poa_attorney_person_id", v === "none" ? null : Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {people.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Kind</Label>
                <Select value={m.poa_kind || ""} onValueChange={(v) => set("poa_kind", v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="specific">Specific</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Scope</Label><Input value={m.poa_scope ?? ""} onChange={(e) => set("poa_scope", e.target.value)} placeholder="e.g. property in Pune only" /></div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!m.poa_registered} onChange={(e) => set("poa_registered", e.target.checked)} /> Registered</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!m.poa_revoked} onChange={(e) => set("poa_revoked", e.target.checked)} /> Revoked</label>
            </div>
          </section>

          {/* AMD */}
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold">Advance Medical Directive (living will)</h3>
            <div className="space-y-1.5"><Label className="text-xs">Life-support preferences</Label><Textarea className="min-h-[56px]" value={m.amd_life_support ?? ""} onChange={(e) => set("amd_life_support", e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Resuscitation preferences</Label><Textarea className="min-h-[56px]" value={m.amd_resuscitation ?? ""} onChange={(e) => set("amd_resuscitation", e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!m.amd_organ_donation} onChange={(e) => set("amd_organ_donation", e.target.checked)} /> Organ donation consented</label>
            <div className="space-y-1.5"><Label className="text-xs">Witness / Judicial Magistrate / notary attestation</Label><Input value={m.amd_attestation ?? ""} onChange={(e) => set("amd_attestation", e.target.value)} /></div>
          </section>

          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={!isTauri()}><Save className="h-4 w-4" /> Save</Button>
            {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">PoA & AMD documents</h3>
            <DocumentAttach types={["poa", "amd"]} />
          </section>

          <DangerZone
            onCleared={() => { setM({}); setHasMeta(false); setSaved(false); }}
            actions={[
              {
                id: "incapacity",
                label: "Clear PoA & AMD details",
                description: (
                  <>
                    <span className="font-medium text-foreground">Clear PoA &amp; AMD details</span> —
                    deletes the Power of Attorney and Advance Medical Directive details saved here.
                    Attached documents and people are kept. This cannot be undone.
                  </>
                ),
                confirmPrompt: "Delete the PoA & AMD details?",
                confirmLabel: "Yes, delete details",
                count: hasMeta ? 1 : 0,
                run: clearIncapacityMeta,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
