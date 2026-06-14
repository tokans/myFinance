import { useCallback, useEffect, useState } from "react";
import {
  BellRing, Plus, Check, Clock, X, Pencil, Trash2, CalendarClock, AlarmClockOff, SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReminderForm } from "@/components/reminders/ReminderForm";
import { isTauri } from "@/lib/environment";
import { todayISO } from "@/lib/format";
import { addDaysISO, bucketFor, byDueDate, dueLabel, type ReminderBucket } from "@/domain/reminders";
import {
  clearAllReminders, completeReminder, countReminders, createReminder, deleteReminder,
  dismissReminder, listOpenReminders, snoozeReminder, updateReminder,
  type Reminder, type ReminderInput,
} from "@/db/reminders";
import { runReminderSweep } from "@/lib/reminderSweep";
import { advanceSip } from "@/db/accounts";
import { DangerZone } from "@/components/common/DangerZone";

const BUCKETS: { key: ReminderBucket; label: string; icon: typeof BellRing; tone: string }[] = [
  { key: "overdue", label: "Overdue", icon: AlarmClockOff, tone: "text-destructive" },
  { key: "due_soon", label: "Due soon", icon: BellRing, tone: "text-amber-600 dark:text-amber-400" },
  { key: "upcoming", label: "Upcoming", icon: CalendarClock, tone: "text-muted-foreground" },
  { key: "snoozed", label: "Snoozed", icon: Clock, tone: "text-muted-foreground" },
];

export function RemindersPage() {
  const today = todayISO();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [reminderCount, setReminderCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      await runReminderSweep(); // refresh derived reminders before reading
      setReminders(await listOpenReminders());
      setReminderCount(await countReminders());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCreate = async (input: ReminderInput) => {
    await createReminder(input);
    setAdding(false);
    await refresh();
  };
  const handleUpdate = async (input: ReminderInput) => {
    if (!editing) return;
    await updateReminder(editing.id, input);
    setEditing(null);
    await refresh();
  };

  const grouped = (b: ReminderBucket) =>
    reminders.filter((r) => bucketFor(r, today) === b).sort(byDueDate);

  return (
    <div className="container max-w-3xl py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <BellRing className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Reminders</h2>
            <p className="text-sm text-muted-foreground">
              FD maturities, document expiries, mutual-fund SIPs and tax deadlines are tracked
              automatically. Add your own for renewals, reviews, and KYC.
            </p>
          </div>
        </div>
        <Button data-testid="reminder-add-button" onClick={() => { setAdding(true); setEditing(null); }} disabled={!isTauri()}>
          <Plus className="h-4 w-4" /> Add reminder
        </Button>
      </header>

      {!isTauri() && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-200">
            Reminders are stored in SQLite, which only runs inside the desktop/mobile app. Start with{" "}
            <code className="rounded bg-amber-200/40 px-1">npm run tauri:dev</code>.
          </CardContent>
        </Card>
      )}

      <Card className="mb-4 border-sky-300/60 bg-sky-50/40 dark:border-sky-800/40 dark:bg-sky-950/20">
        <CardContent className="py-2.5 text-xs text-sky-900 dark:text-sky-200">
          Reminders pop up as a notification when you open the app. Email, SMS and push aren't
          available — this app runs entirely on your device with no server.
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-4 border-destructive/60">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {adding && (
        <div className="mb-4">
          <ReminderForm onSubmit={handleCreate} onCancel={() => setAdding(false)} />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : reminders.length === 0 && !adding ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium">No open reminders</p>
            <p className="text-xs text-muted-foreground">
              You're all caught up. New FD maturities and document expiries will appear here
              automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {BUCKETS.map(({ key, label, icon: Icon, tone }) => {
            const items = grouped(key);
            if (items.length === 0) return null;
            return (
              <section key={key} className="space-y-2">
                <h3 className={`flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide ${tone}`}>
                  <Icon className="h-4 w-4" /> {label} <span className="text-muted-foreground">({items.length})</span>
                </h3>
                <ul className="space-y-2">
                  {items.map((r) =>
                    editing?.id === r.id ? (
                      <li key={r.id}>
                        <ReminderForm initial={r} onSubmit={handleUpdate} onCancel={() => setEditing(null)} />
                      </li>
                    ) : (
                      <li key={r.id}>
                        <ReminderRow
                          reminder={r}
                          today={today}
                          onComplete={() => act(() => completeReminder(r.id, today))}
                          onSnooze={(days) => act(() => snoozeReminder(r.id, addDaysISO(today, days)))}
                          onDismiss={() => act(() => dismissReminder(r.id))}
                          onAdvanceSip={
                            r.account_id != null
                              ? () => act(() => advanceSip(r.account_id!, r.due_date))
                              : undefined
                          }
                          onEdit={() => { setEditing(r); setAdding(false); }}
                          onDelete={() => act(() => deleteReminder(r.id))}
                        />
                      </li>
                    ),
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <DangerZone
        onCleared={refresh}
        actions={[
          {
            id: "reminders",
            label: "Clear reminders",
            description: (
              <>
                <span className="font-medium text-foreground">Clear reminders</span> — deletes all{" "}
                {reminderCount} reminder{reminderCount === 1 ? "" : "s"}. Your own reminders are gone
                for good; automatic ones (FD maturities, SIPs, expiries) are regenerated from your
                data on the next sweep. This cannot be undone.
              </>
            ),
            confirmPrompt: "Delete every reminder?",
            confirmLabel: "Yes, delete reminders",
            count: reminderCount,
            run: clearAllReminders,
          },
        ]}
      />
    </div>
  );
}

function ReminderRow({
  reminder, today, onComplete, onSnooze, onDismiss, onAdvanceSip, onEdit, onDelete,
}: {
  reminder: Reminder;
  today: string;
  onComplete: () => void;
  onSnooze: (days: number) => void;
  onDismiss: () => void;
  onAdvanceSip?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const derived = reminder.source === "derived";
  const isSip = reminder.type === "sip" && onAdvanceSip != null;
  return (
    <Card data-testid="reminder-row">
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{reminder.title}</span>
            {isSip && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                SIP
              </span>
            )}
            {reminder.cadence === "annual" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                yearly
              </span>
            )}
            {derived && !isSip && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                auto
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {reminder.due_date} · {dueLabel(reminder.due_date, today)}
            {reminder.snoozed_until && reminder.snoozed_until > today ? ` · snoozed to ${reminder.snoozed_until}` : ""}
          </p>
          {reminder.notes && <p className="mt-0.5 text-xs text-muted-foreground">{reminder.notes}</p>}
        </div>
        <div className="flex items-center gap-1">
          {isSip ? (
            // SIP: Done and Ignore both confirm this cycle and roll the reminder
            // forward to next month (advanceSip). Snooze stays available.
            <>
              <Button variant="ghost" size="icon" onClick={onAdvanceSip} aria-label="SIP done" title="Done — remind next month">
                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onSnooze(7)} aria-label="Snooze 7 days" title="Snooze 7 days">
                <Clock className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onAdvanceSip} aria-label="Ignore SIP" title="Ignore — remind next month">
                <SkipForward className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon" onClick={onComplete} aria-label="Mark done" title="Mark done">
                <Check className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onSnooze(7)} aria-label="Snooze 7 days" title="Snooze 7 days">
                <Clock className="h-4 w-4" />
              </Button>
              {derived ? (
                <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete" title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
