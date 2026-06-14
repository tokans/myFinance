import { useState } from "react";
import { Users, FileDown, Wand2 } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isTauri } from "@/lib/environment";
import { todayISO } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import { buildBriefing } from "@/domain/familyPack";
import { gatherSnapshot } from "@/lib/estateSnapshot";

export function FamilyPackPage() {
  const currency = useSettingsStore((s) => s.settings.currency);
  const [person, setPerson] = useState("");
  const [redact, setRedact] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const snap = await gatherSnapshot(todayISO(), currency);
      setText(buildBriefing(snap, { designatedPerson: person, redactNumbers: redact }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportText = async () => {
    if (!text) return;
    const filename = "family-briefing.txt";
    try {
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const path = await save({ defaultPath: filename });
        if (path) await writeTextFile(path, text);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
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
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Users className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Family communication pack</h2>
          <p className="text-sm text-muted-foreground">A "what-if" briefing for a designated family member.</p>
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">Reads from SQLite — open the desktop/mobile app.</CardContent>
        </Card>
      )}
      {error && <Card className="mb-4 border-destructive/60"><CardContent className="py-3 text-xs text-destructive">{error}</CardContent></Card>}

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Designated person</Label>
            <Input data-testid="familypack-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. Priya (spouse)" />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={redact} onChange={(e) => setRedact(e.target.checked)} />
            Redact account values
          </label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" data-testid="familypack-generate" onClick={generate} disabled={busy || !isTauri()}><Wand2 className="h-4 w-4" /> {busy ? "Generating…" : "Generate"}</Button>
          {text && <Button size="sm" variant="outline" onClick={exportText}><FileDown className="h-4 w-4" /> Export</Button>}
        </div>
      </div>

      {text && <Textarea data-testid="familypack-output" className="mt-3 min-h-[320px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />}
    </div>
  );
}
