/**
 * Pure scheduling logic for Mutual-Fund SIPs (Systematic Investment Plans).
 *
 * A SIP debits a fixed amount on the same day each month. We model it with three
 * pieces of account state (see migration 0023):
 *   - `sipDay`      — the debit day-of-month (1..31).
 *   - `sipAmount`   — optional installment amount (display only).
 *   - `sipLastDone` — 'YYYY-MM-DD' of the most recent occurrence the user marked
 *                     Done/Ignore. This is the cycle marker that rolls the derived
 *                     reminder forward a month.
 *
 * No DB, no React — all date math is here so it's deterministic and unit-testable.
 * Day-precision 'YYYY-MM-DD' helpers are reused from the shared reminders engine.
 * See [[project_shared_core_extracted]] and the device-sync/reminders modules.
 */
import { daysBetween } from "@/domain/reminders";

/** How many days before the debit date the SIP reminder starts nagging. */
export const SIP_LEAD_DAYS = 3;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days in a given 1-based month of a year (handles leap Feb). */
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** 'YYYY-MM' of a 'YYYY-MM-DD' (or 'YYYY-MM') string. */
function ymOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Add `n` whole months to a 'YYYY-MM' string. */
export function addMonthsYM(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + n;
  const year = Math.floor(total / 12);
  const month1 = (total % 12) + 1;
  return `${year}-${pad2(month1)}`;
}

/**
 * The SIP occurrence date in a given month, clamping the day to the month's
 * length (e.g. day 31 in February → 28/29). `ym` is 'YYYY-MM'.
 */
export function occurrenceForMonth(ym: string, sipDay: number): string {
  const [y, m] = ym.split("-").map(Number);
  const day = Math.min(Math.max(sipDay, 1), daysInMonth(y!, m!));
  return `${ym}-${pad2(day)}`;
}

/** The next SIP occurrence on or after `today` (this month's, else next month's). */
export function nextOccurrenceOnOrAfter(today: string, sipDay: number): string {
  const thisOcc = occurrenceForMonth(ymOf(today), sipDay);
  if (thisOcc >= today) return thisOcc;
  return occurrenceForMonth(addMonthsYM(ymOf(today), 1), sipDay);
}

export interface SipReminderPlanInput {
  today: string;
  sipDay: number;
  /** 'YYYY-MM-DD' occurrence already actioned, or null. */
  sipLastDone: string | null;
  /** Due date of the SIP reminder row that already exists for this account, or null. */
  existingDueDate: string | null;
}

/**
 * Decide the derived SIP reminder for one account.
 *
 * Returns the due date the reminder should carry, or null when no reminder
 * should exist right now. The lifecycle (not the daily sync) owns an existing
 * reminder's due date, so:
 *
 *  - If a reminder already exists, KEEP it at its current due date for as long as
 *    it hasn't been actioned (`sipLastDone < existingDueDate`). This is what lets
 *    an unactioned reminder slide into "overdue" and keep nagging.
 *  - Otherwise create one only once the upcoming occurrence is within
 *    `SIP_LEAD_DAYS` of today and hasn't already been actioned.
 *
 * Marking Done/Ignore sets `sipLastDone` to the occurrence date and drops the
 * row; the next month, within the lead window, this recreates it.
 */
export function sipReminderPlan(input: SipReminderPlanInput): { dueDate: string } | null {
  const { today, sipDay, sipLastDone, existingDueDate } = input;

  if (existingDueDate) {
    const actioned = sipLastDone != null && sipLastDone >= existingDueDate;
    return actioned ? null : { dueDate: existingDueDate };
  }

  const upcoming = nextOccurrenceOnOrAfter(today, sipDay);
  const actioned = sipLastDone != null && sipLastDone >= upcoming;
  if (actioned) return null;
  return daysBetween(today, upcoming) <= SIP_LEAD_DAYS ? { dueDate: upcoming } : null;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 21 → "21st"… */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export type SipTone = "due" | "idle";

/**
 * Short chip label for a Mutual-Fund account's SIP, e.g.
 * "SIP 5th · due in 2 days", "SIP 5th · overdue", "SIP 5th · monthly".
 * `tone` is "due" when it warrants attention (in the lead window / recently
 * overdue), else "idle".
 */
export function sipIndicatorLabel(
  today: string,
  sipDay: number,
  sipLastDone: string | null,
): { text: string; tone: SipTone } {
  const head = `SIP ${ordinal(sipDay)}`;
  const thisOcc = occurrenceForMonth(ymOf(today), sipDay);

  // A recently-passed, un-actioned occurrence reads as overdue (bounded so a
  // freshly-added account doesn't show an ancient month as overdue forever).
  const overdueUnhandled =
    thisOcc < today &&
    (sipLastDone == null || sipLastDone < thisOcc) &&
    daysBetween(thisOcc, today) <= 31;
  if (overdueUnhandled) return { text: `${head} · overdue`, tone: "due" };

  let upcoming = nextOccurrenceOnOrAfter(today, sipDay);
  if (sipLastDone != null && sipLastDone >= upcoming) {
    upcoming = occurrenceForMonth(addMonthsYM(ymOf(upcoming), 1), sipDay);
  }
  const days = daysBetween(today, upcoming);
  if (days <= SIP_LEAD_DAYS) {
    const when = days <= 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} days`;
    return { text: `${head} · ${when}`, tone: "due" };
  }
  return { text: `${head} · monthly`, tone: "idle" };
}
