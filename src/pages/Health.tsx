import { useCallback, useEffect, useState } from "react";
import { HeartPulse, Save, Download, AlertTriangle, Phone } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isTauri } from "@/lib/environment";
import { buildIceLines, iceCardText, iceContactsWithPhone, isIceEmpty, type IceInput } from "@/domain/ice";
import { clearHealthProfile, getHealthProfile, upsertHealthProfile, type HealthProfileInput } from "@/db/health";
import { listPeople, type Person } from "@/db/people";
import { DangerZone } from "@/components/common/DangerZone";

const EMPTY: HealthProfileInput = {
  full_name: "", blood_group: "", allergies: "", chronic_conditions: "", medications: "",
  organ_donor: false, notes: "",
};

export function HealthPage() {
  const [form, setForm] = useState<HealthProfileInput>(EMPTY);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [profile, ppl] = await Promise.all([getHealthProfile(), listPeople()]);
      setHasProfile(!!profile);
      if (profile) {
        setForm({
          full_name: profile.full_name ?? "",
          blood_group: profile.blood_group ?? "",
          allergies: profile.allergies ?? "",
          chronic_conditions: profile.chronic_conditions ?? "",
          medications: profile.medications ?? "",
          organ_donor: profile.organ_donor === 1,
          notes: profile.notes ?? "",
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

  const set = <K extends keyof HealthProfileInput>(k: K, v: HealthProfileInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await upsertHealthProfile(form);
      setHasProfile(true);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Tier-0 (always-visible) people are the ICE emergency contacts.
  const tier0 = people.filter((p) => p.access_tier === 0);
  const ice: IceInput = {
    fullName: form.full_name,
    bloodGroup: form.blood_group,
    allergies: form.allergies,
    conditions: form.chronic_conditions,
    medications: form.medications,
    organDonor: form.organ_donor,
    contacts: tier0.map((p) => ({ name: p.name, relationship: p.relationship, phone: p.phone })),
  };

  const exportCard = async () => {
    const text = iceCardText(ice);
    const filename = "ICE-card.txt";
    try {
      if (isTauri()) {
        const { save: saveDialog } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const path = await saveDialog({ defaultPath: filename });
        if (path) await writeTextFile(path, text);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400">
          <HeartPulse className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Health & ICE file</h2>
          <p className="text-sm text-muted-foreground">
            A grab-and-go medical summary for a hospitalisation, shareable in seconds.
          </p>
        </div>
      </header>

      <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:border-amber-700/50 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-2 py-3 text-xs leading-snug text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This is a personal record, not medical advice, and is never verified by the app. Keep it
            current. In an emergency, call local emergency services and rely on professional judgment.
          </span>
        </CardContent>
      </Card>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Stored in SQLite — open the desktop/mobile app (<code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code>).
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
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
            <Field label="Full name"><Input data-testid="health-name" value={form.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></Field>
            <Field label="Blood group"><Input data-testid="health-blood" value={form.blood_group ?? ""} onChange={(e) => set("blood_group", e.target.value)} placeholder="e.g. O+" /></Field>
            <Field label="Allergies" full><Textarea data-testid="health-allergies" className="min-h-[56px]" value={form.allergies ?? ""} onChange={(e) => set("allergies", e.target.value)} /></Field>
            <Field label="Chronic conditions" full><Textarea className="min-h-[56px]" value={form.chronic_conditions ?? ""} onChange={(e) => set("chronic_conditions", e.target.value)} /></Field>
            <Field label="Current medications & dosages" full><Textarea className="min-h-[56px]" value={form.medications ?? ""} onChange={(e) => set("medications", e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!form.organ_donor} onChange={(e) => set("organ_donor", e.target.checked)} />
              Registered organ donor
            </label>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button data-testid="health-save" onClick={save} disabled={saving || !isTauri()}>
                <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
              </Button>
              {saved && <span data-testid="health-saved" className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
            </div>
          </section>

          {/* ICE card preview */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">ICE card preview</h3>
              <Button size="sm" variant="outline" onClick={exportCard} disabled={isIceEmpty(ice)}>
                <Download className="h-4 w-4" /> Export
              </Button>
            </div>
            <Card>
              <CardContent className="py-4">
                {isIceEmpty(ice) ? (
                  <p className="text-sm text-muted-foreground">
                    Fill in the fields above (and add Tier-0 people on the People page) to build your card.
                  </p>
                ) : (
                  <div className="space-y-2" data-testid="health-ice-card">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      {buildIceLines(ice).map((l) => (
                        <div key={l.label} className="contents">
                          <dt className="font-medium text-muted-foreground">{l.label}</dt>
                          <dd>{l.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {iceContactsWithPhone(ice.contacts).length > 0 && (
                      <div className="border-t pt-2">
                        <p className="text-xs font-medium text-muted-foreground">Emergency contacts</p>
                        <ul className="mt-1 space-y-0.5 text-sm">
                          {iceContactsWithPhone(ice.contacts).map((c, i) => (
                            <li key={i} className="flex items-center gap-1.5">
                              <Phone className="h-3 w-3 text-muted-foreground" />
                              {c.name}{c.relationship ? ` (${c.relationship})` : ""} — {c.phone}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <p className="text-[11px] text-muted-foreground">
              Emergency contacts are your <strong>Tier-0</strong> people. Manage them on the People page.
              ID and insurance card scans can be attached to a person as encrypted documents.
            </p>
          </section>

          <DangerZone
            onCleared={() => { setForm(EMPTY); setHasProfile(false); setSaved(false); }}
            actions={[
              {
                id: "health",
                label: "Clear health profile",
                description: (
                  <>
                    <span className="font-medium text-foreground">Clear health profile</span> — deletes
                    your saved ICE medical details. Your Tier-0 emergency contacts (on the People page)
                    are kept. This cannot be undone.
                  </>
                ),
                confirmPrompt: "Delete the health profile?",
                confirmLabel: "Yes, delete profile",
                count: hasProfile ? 1 : 0,
                run: clearHealthProfile,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
