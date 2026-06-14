import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, Users, Upload, Phone, Mail, UserPlus, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PersonForm, type PersonKind } from "@/components/people/PersonForm";
import { isProfessionalType } from "@/masters/registry";
import { isTauri } from "@/lib/environment";
import { accessTierLabel } from "@/lib/accessTiers";
import { mapPeopleSheet } from "@/lib/peopleImport";
import { readWorkbook } from "@/excel/parse";
import {
  clearAllPeople, createPerson, deletePerson, listPeople, updatePerson,
  type Person, type PersonInput,
} from "@/db/people";
import { DangerZone } from "@/components/common/DangerZone";

export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<PersonKind | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setPeople(await listPeople());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCreate = async (input: PersonInput) => {
    await createPerson(input);
    setAdding(null);
    await refresh();
  };

  const startAdding = (kind: PersonKind) => { setAdding(kind); setEditing(null); };

  const handleUpdate = async (input: PersonInput) => {
    if (!editing) return;
    await updatePerson(editing.id, input);
    setEditing(null);
    await refresh();
  };

  const handleDelete = async (p: Person) => {
    if (!confirm(`Remove ${p.name}? Their attached documents are kept but unlinked.`)) return;
    await deletePerson(p.id);
    await refresh();
  };

  const handleImport: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportNote(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const sheets = readWorkbook(buf);
      const rows = sheets[0]?.rows ?? [];
      const mapped = mapPeopleSheet(rows);
      if (mapped.length === 0) {
        setImportNote("No rows with a name were found in the first sheet.");
        return;
      }
      if (!confirm(`Import ${mapped.length} ${mapped.length === 1 ? "person" : "people"} from "${file.name}"? (All added at Tier 0 — review afterwards.)`)) {
        return;
      }
      for (const p of mapped) await createPerson(p);
      setImportNote(`Imported ${mapped.length} ${mapped.length === 1 ? "person" : "people"}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="container max-w-3xl py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">People</h2>
            <p className="text-sm text-muted-foreground">
              Family, executor, nominees, doctors, advisors — the contacts your estate plan links to.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Label
            htmlFor="people-import"
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent ${isTauri() ? "" : "pointer-events-none opacity-50"}`}
          >
            <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import"}
            <input
              id="people-import"
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.xlsm,.csv,.tsv"
              onChange={handleImport}
              disabled={!isTauri() || importing}
            />
          </Label>
          <Button data-testid="person-add-personal" variant="outline" onClick={() => startAdding("personal")} disabled={!isTauri()}>
            <UserPlus className="h-4 w-4" /> Add family/friend
          </Button>
          <Button onClick={() => startAdding("professional")} disabled={!isTauri()}>
            <Briefcase className="h-4 w-4" /> Add professional
          </Button>
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            People are stored in SQLite, which only runs inside the desktop/mobile app. Start with{" "}
            <code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code>.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {importNote && (
        <Card className="mb-4 border-sky-300/60 bg-sky-50/40 dark:bg-sky-950/20">
          <CardContent className="py-3 text-xs text-sky-900 dark:text-sky-200">{importNote}</CardContent>
        </Card>
      )}

      {adding && (
        <div className="mb-4">
          <PersonForm kind={adding} onSubmit={handleCreate} onCancel={() => setAdding(null)} />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : people.length === 0 && !adding ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium">No people yet</p>
            <p className="text-xs text-muted-foreground">
              Add family members, your executor, nominees, or doctors. You can also import a list from
              Excel/CSV (columns like name, relationship, phone, email).
            </p>
            {isTauri() && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => startAdding("personal")}>
                  <UserPlus className="h-4 w-4" /> Add family/friend
                </Button>
                <Button onClick={() => startAdding("professional")}>
                  <Briefcase className="h-4 w-4" /> Add professional
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {people.map((p) => (
            <li key={p.id}>
              {editing?.id === p.id ? (
                <PersonForm
                  initial={p}
                  kind={isProfessionalType(p.relationship) ? "professional" : "personal"}
                  onSubmit={handleUpdate}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <Card data-testid="person-row">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.relationship && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {p.relationship}
                          </span>
                        )}
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                          {accessTierLabel(p.access_tier)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {p.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{p.phone}</span>}
                        {p.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{p.email}</span>}
                        {!p.phone && !p.email && <span>—</span>}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setAdding(null); }} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(p)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              )}
            </li>
          ))}
        </ul>
      )}

      <DangerZone
        onCleared={refresh}
        actions={[
          {
            id: "people",
            label: "Clear people",
            description: (
              <>
                <span className="font-medium text-foreground">Clear people</span> — removes all{" "}
                {people.length} contact{people.length === 1 ? "" : "s"}. Their nominee/co-holder links
                and access grants are removed too; attached documents are kept but unlinked. This
                cannot be undone.
              </>
            ),
            confirmPrompt: "Delete every person?",
            confirmLabel: "Yes, delete people",
            count: people.length,
            run: clearAllPeople,
          },
        ]}
      />
    </div>
  );
}
