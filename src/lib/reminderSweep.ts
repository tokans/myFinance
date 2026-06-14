import { todayISO } from "@/lib/format";
import { runReminderSweep as sweep } from "sharedcorelib/reminders";
import { listOpenReminders, markFired, syncDerivedReminders } from "@/db/reminders";

/**
 * Run on app open (and after data changes that affect reminders): refresh derived
 * reminders, then raise a single OS notification summarising anything
 * overdue/due-soon that hasn't already been notified today. The sweep MECHANISM
 * now lives in the shared core (`sharedcorelib/reminders` → `runReminderSweep`);
 * this file supplies myFinance's DB adapters + today. Best-effort — any failure is
 * swallowed so it never blocks startup. Returns the open count.
 * See [[project_shared_core_extracted]].
 */
export function runReminderSweep(): Promise<number> {
  return sweep({
    today: todayISO(),
    syncDerived: syncDerivedReminders,
    listOpen: listOpenReminders,
    markFired,
  });
}
