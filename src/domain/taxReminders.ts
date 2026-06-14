/**
 * Statutory Indian income-tax deadlines, as fixed calendar dates, used to derive
 * recurring annual reminders (advance-tax installments + the ITR filing date).
 *
 * Pure data + date math — no DB, no React. Each deadline recurs every year on the
 * same month/day; `nextAnnualOnOrAfter` picks the next occurrence on or after a
 * given day. The reminder it backs is `cadence:'annual'` so marking it done rolls
 * it forward a year, and its due date is owned by the reminder lifecycle once
 * created (so an un-filed deadline stays overdue and keeps nagging). See
 * `db/reminders.ts` `syncDerivedReminders`.
 *
 * Dates reflect the common deadlines for an individual not subject to tax audit:
 *   - Advance tax: 15 Jun / 15 Sep / 15 Dec / 15 Mar (cumulative 15/45/75/100%).
 *   - ITR filing: 31 Jul.
 * These are general defaults, not personalised tax advice.
 */

export interface TaxDeadline {
  /** Stable suffix for the derived reminder's dedupe key (`tax:{key}`). */
  key: string;
  title: string;
  /** Recurring date as 'MM-DD'. */
  monthDay: string;
}

export const INDIA_TAX_DEADLINES: TaxDeadline[] = [
  { key: "advance_q1", title: "Advance tax — 1st installment (15%)", monthDay: "06-15" },
  { key: "advance_q2", title: "Advance tax — 2nd installment (45% cumulative)", monthDay: "09-15" },
  { key: "advance_q3", title: "Advance tax — 3rd installment (75% cumulative)", monthDay: "12-15" },
  { key: "advance_q4", title: "Advance tax — 4th installment (100%)", monthDay: "03-15" },
  { key: "itr_filing", title: "File income tax return (ITR)", monthDay: "07-31" },
];

/** Next 'YYYY-MM-DD' occurrence of a recurring 'MM-DD' date, on or after `today`. */
export function nextAnnualOnOrAfter(today: string, monthDay: string): string {
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${monthDay}`;
  return candidate >= today ? candidate : `${year + 1}-${monthDay}`;
}
