import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Plus, Trash2, CalendarClock } from "lucide-react";
import { BackLink } from "@/components/layout/BackLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { isTauri } from "@/lib/environment";
import { todayISO } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings.store";
import {
  annualReviewChecklist, fyReviewDueDate, lifeEventLabel, LIFE_EVENT_TYPES,
  reviewChecklistFor, type LifeEventType,
} from "@/domain/review";
import { addLifeEvent, clearAllLifeEvents, deleteLifeEvent, listLifeEvents, type LifeEvent } from "@/db/lifeEvents";
import { DangerZone } from "@/components/common/DangerZone";

export function ReviewPage() {
  const fyStart = useSettingsStore((s) => s.settings.fyStartMonth);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<LifeEventType>("marriage");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try { setEvents(await listLifeEvents()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    await addLifeEvent(type, date || null, notes || null);
    setNotes("");
    await refresh();
  };

  return (
    <div className="container max-w-3xl py-6">
      <BackLink />
      <header className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><ClipboardCheck className="h-6 w-6" /></div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Annual review & life events</h2>
          <p className="text-sm text-muted-foreground">A yearly checklist, plus tailored playbooks when life changes.</p>
        </div>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">Stored in SQLite — open the desktop/mobile app.</CardContent>
        </Card>
      )}
      {error && <Card className="mb-4 border-destructive/60"><CardContent className="py-3 text-xs text-destructive">{error}</CardContent></Card>}

      {/* Annual review */}
      <section className="mb-6 space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Annual review <span className="inline-flex items-center gap-1 text-xs font-normal normal-case"><CalendarClock className="h-3.5 w-3.5" /> next due {fyReviewDueDate(fyStart, todayISO())}</span>
        </h3>
        <Card>
          <CardContent className="py-3">
            <ul className="space-y-1.5 text-sm">
              {annualReviewChecklist().map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Life events */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Life events</h3>
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <Select value={type} onValueChange={(v) => setType(v as LifeEventType)}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{LIFE_EVENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-9 w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input className="h-9 w-48" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button size="sm" onClick={add} disabled={!isTauri()}><Plus className="h-4 w-4" /> Log event</Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No life events logged. Logging one generates a tailored checklist.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id}>
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{lifeEventLabel(e.type)}{e.event_date ? ` · ${e.event_date}` : ""}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => { await deleteLifeEvent(e.id); await refresh(); }} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                    <ul className="space-y-1 text-sm">
                      {reviewChecklistFor(e.type).map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DangerZone
        onCleared={refresh}
        actions={[
          {
            id: "life_events",
            label: "Clear life events",
            description: (
              <>
                <span className="font-medium text-foreground">Clear life events</span> — deletes all{" "}
                {events.length} logged life event{events.length === 1 ? "" : "s"}. The annual-review
                checklist is unaffected. This cannot be undone.
              </>
            ),
            confirmPrompt: "Delete every life event?",
            confirmLabel: "Yes, delete events",
            count: events.length,
            run: clearAllLifeEvents,
          },
        ]}
      />
    </div>
  );
}
