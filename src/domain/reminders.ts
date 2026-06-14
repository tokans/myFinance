/**
 * Pure scheduling logic for reminders. The implementation now lives in the shared
 * core (`sharedcorelib/reminders`); this module re-exports the scheduling API so
 * existing `@/domain/reminders` import sites stay unchanged. All functions take an
 * explicit `today` ('YYYY-MM-DD') so they're deterministic. The OS-notification +
 * sweep machinery lives alongside it in the core but is surfaced via `@/lib/notify`
 * and `@/lib/reminderSweep`. See [[project_shared_core_extracted]].
 */
export {
  DUE_SOON_DAYS,
  daysBetween,
  addDaysISO,
  addYearsISO,
  isSnoozed,
  bucketFor,
  shouldNotify,
  nextAnnual,
  fyReviewDueDate,
  byDueDate,
  dueLabel,
} from "sharedcorelib/reminders";
export type { ReminderBucket, ReminderLike } from "sharedcorelib/reminders";
