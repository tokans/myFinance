import { query, exec, getDb, T } from "./client";
import { nextAnnual } from "@/domain/reminders";
import { sipReminderPlan } from "@/domain/sip";
import { INDIA_TAX_DEADLINES, nextAnnualOnOrAfter } from "@/domain/taxReminders";
import { todayISO } from "@/lib/format";

export type ReminderType =
  | "fd_maturity"
  | "doc_expiry"
  | "review"
  | "custom"
  | "policy_renewal"
  | "nominee_review"
  | "sip"
  | "tax_deadline";

export type ReminderCadence = "once" | "annual";
export type ReminderStatus = "open" | "done" | "dismissed";

export interface Reminder {
  id: number;
  type: ReminderType;
  title: string;
  notes: string | null;
  due_date: string;
  cadence: ReminderCadence;
  source: "manual" | "derived";
  dedupe_key: string | null;
  status: ReminderStatus;
  snoozed_until: string | null;
  last_fired_on: string | null;
  account_id: number | null;
  document_id: number | null;
  person_id: number | null;
  created_at: string;
}

export interface ReminderInput {
  type?: ReminderType;
  title: string;
  notes?: string | null;
  due_date: string;
  cadence?: ReminderCadence;
  account_id?: number | null;
  document_id?: number | null;
  person_id?: number | null;
}

/** Open reminders (not done/dismissed), earliest due first. */
export async function listOpenReminders(): Promise<Reminder[]> {
  return query<Reminder>(
    `SELECT * FROM ${T.reminders} WHERE status = 'open' ORDER BY due_date, title COLLATE NOCASE`,
  );
}

export async function listAllReminders(): Promise<Reminder[]> {
  return query<Reminder>(`SELECT * FROM ${T.reminders} ORDER BY due_date, title COLLATE NOCASE`);
}

export async function createReminder(input: ReminderInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO ${T.reminders} (type, title, notes, due_date, cadence, source, account_id, document_id, person_id)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
    [
      input.type ?? "custom",
      input.title.trim(),
      input.notes?.trim() || null,
      input.due_date,
      input.cadence ?? "once",
      input.account_id ?? null,
      input.document_id ?? null,
      input.person_id ?? null,
    ],
  );
  return Number(result.lastInsertId);
}

export async function updateReminder(id: number, input: ReminderInput): Promise<void> {
  await exec(
    `UPDATE ${T.reminders} SET type = ?, title = ?, notes = ?, due_date = ?, cadence = ? WHERE id = ?`,
    [
      input.type ?? "custom",
      input.title.trim(),
      input.notes?.trim() || null,
      input.due_date,
      input.cadence ?? "once",
      id,
    ],
  );
}

export async function snoozeReminder(id: number, until: string): Promise<void> {
  await exec(`UPDATE ${T.reminders} SET snoozed_until = ? WHERE id = ?`, [until, id]);
}

export async function dismissReminder(id: number): Promise<void> {
  await exec(`UPDATE ${T.reminders} SET status = 'dismissed' WHERE id = ?`, [id]);
}

/**
 * Mark a reminder done. An `annual` reminder instead rolls forward to its next
 * yearly occurrence and stays open, clearing any snooze — so recurring reviews
 * never silently disappear.
 */
export async function completeReminder(id: number, today: string): Promise<void> {
  const rows = await query<Reminder>(`SELECT * FROM ${T.reminders} WHERE id = ?`, [id]);
  const r = rows[0];
  if (!r) return;
  if (r.cadence === "annual") {
    const next = nextAnnual(r.due_date, today);
    await exec(
      `UPDATE ${T.reminders} SET due_date = ?, snoozed_until = NULL, last_fired_on = NULL WHERE id = ?`,
      [next, id],
    );
  } else {
    await exec(`UPDATE ${T.reminders} SET status = 'done' WHERE id = ?`, [id]);
  }
}

export async function deleteReminder(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.reminders} WHERE id = ?`, [id]);
}

/** Total number of reminders (manual + derived, any status). */
export async function countReminders(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.reminders}`);
  return rows[0]?.n ?? 0;
}

/**
 * Delete every reminder. Manual reminders are gone for good; derived reminders
 * are regenerated from their source data on the next reminder sweep.
 */
export async function clearAllReminders(): Promise<void> {
  await exec(`DELETE FROM ${T.reminders}`);
}

export async function markFired(id: number, today: string): Promise<void> {
  await exec(`UPDATE ${T.reminders} SET last_fired_on = ? WHERE id = ?`, [today, id]);
}

/**
 * Upsert a derived reminder by its stable dedupe key. Refreshes the title, due
 * date and links, but never touches user-owned state (status/snooze/last_fired)
 * on an existing row — so syncing on every app open is idempotent and respects
 * a snooze or dismissal.
 */
async function upsertDerived(
  dedupeKey: string,
  fields: Omit<ReminderInput, never> & { type: ReminderType },
): Promise<void> {
  await exec(
    `INSERT INTO ${T.reminders} (type, title, notes, due_date, cadence, source, dedupe_key, account_id, document_id, person_id)
     VALUES (?, ?, ?, ?, ?, 'derived', ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       title = excluded.title,
       notes = excluded.notes,
       due_date = excluded.due_date,
       account_id = excluded.account_id,
       document_id = excluded.document_id,
       person_id = excluded.person_id`,
    [
      fields.type,
      fields.title.trim(),
      fields.notes?.trim() || null,
      fields.due_date,
      fields.cadence ?? "once",
      dedupeKey,
      fields.account_id ?? null,
      fields.document_id ?? null,
      fields.person_id ?? null,
    ],
  );
}

interface DerivedSource {
  dedupe_key: string;
  type: ReminderType;
  title: string;
  due_date: string;
  cadence?: ReminderCadence;
  notes?: string | null;
  account_id?: number | null;
  document_id?: number | null;
}

/**
 * Recompute derived reminders from current data and reconcile the table:
 * - FD accounts with a maturity date → a one-off "FD matures" reminder.
 * - Documents with an expiry date → a one-off "expires" reminder.
 * - Insurance policies with a renewal date → a "policy renewal" reminder.
 * - Mutual-fund accounts with a SIP day → a recurring "SIP due" reminder that
 *   appears a few days before the debit date and rolls forward each month once
 *   the user marks it Done/Ignore (see `domain/sip.ts` and `advanceSip`).
 * Removes derived rows whose source has since lost its date (e.g. maturity
 * cleared) so the inbox doesn't keep stale items. Returns the live count.
 *
 * `today` ('YYYY-MM-DD') is injectable so the SIP window math stays deterministic
 * under test; it defaults to the real current date.
 */
export async function syncDerivedReminders(today: string = todayISO()): Promise<number> {
  const sources: DerivedSource[] = [];

  const fds = await query<{ id: number; name: string; maturity_date: string }>(
    `SELECT id, name, maturity_date FROM ${T.accounts}
      WHERE is_archived = 0 AND type = 'fixed_deposit'
        AND maturity_date IS NOT NULL AND maturity_date <> ''`,
  );
  for (const fd of fds) {
    sources.push({
      dedupe_key: `fd:${fd.id}`,
      type: "fd_maturity",
      title: `FD matures: ${fd.name}`,
      due_date: fd.maturity_date,
      account_id: fd.id,
    });
  }

  const docs = await query<{ id: number; title: string; expires_on: string }>(
    `SELECT id, title, expires_on FROM ${T.documents}
      WHERE expires_on IS NOT NULL AND expires_on <> ''`,
  );
  for (const d of docs) {
    sources.push({
      dedupe_key: `doc:${d.id}`,
      type: "doc_expiry",
      title: `Document expires: ${d.title}`,
      due_date: d.expires_on,
      document_id: d.id,
    });
  }

  const policies = await query<{ id: number; insurer: string; renewal_date: string; account_id: number | null }>(
    `SELECT id, insurer, renewal_date, account_id FROM ${T.insurancePolicies}
      WHERE renewal_date IS NOT NULL AND renewal_date <> ''`,
  );
  for (const p of policies) {
    sources.push({
      dedupe_key: `policy:${p.id}`,
      type: "policy_renewal",
      title: `Policy renewal: ${p.insurer}`,
      due_date: p.renewal_date,
      account_id: p.account_id ?? null,
    });
  }

  // SIP reminders: recurring monthly, surfaced only inside the lead window and
  // owned by the reminder lifecycle (not recomputed) once created. We read any
  // existing sip:* row's due date so an unactioned reminder keeps its date and
  // slides into "overdue" rather than being reset each sync.
  const sips = await query<{
    id: number; name: string; currency: string;
    sip_day: number; sip_amount: number | null; sip_last_done: string | null;
  }>(
    `SELECT id, name, currency, sip_day, sip_amount, sip_last_done FROM ${T.accounts}
      WHERE is_archived = 0 AND type = 'mutual_funds' AND sip_day IS NOT NULL`,
  );
  const existingSip = await query<{ dedupe_key: string; due_date: string }>(
    `SELECT dedupe_key, due_date FROM ${T.reminders} WHERE source = 'derived' AND type = 'sip'`,
  );
  const sipDueByKey = new Map(existingSip.map((r) => [r.dedupe_key, r.due_date]));
  for (const s of sips) {
    const key = `sip:${s.id}`;
    const plan = sipReminderPlan({
      today,
      sipDay: s.sip_day,
      sipLastDone: s.sip_last_done,
      existingDueDate: sipDueByKey.get(key) ?? null,
    });
    if (!plan) continue;
    const amount =
      s.sip_amount != null ? `${s.currency} ${s.sip_amount.toLocaleString()} · ` : "";
    sources.push({
      dedupe_key: key,
      type: "sip",
      title: `SIP due: ${s.name}`,
      due_date: plan.dueDate,
      notes: `${amount}Mark Done or Ignore`,
      account_id: s.id,
    });
  }

  // Income-tax deadlines: recurring annual reminders for the advance-tax
  // installments and the ITR filing date. Only generated once the user is using
  // the tax module (any tax_years row), matching the "derived from data" rule for
  // the other derived reminders. Each is cadence:'annual' with a lifecycle-owned
  // due date — like SIP, an existing row keeps its date (so it can go overdue),
  // and completing it rolls forward a year (see completeReminder).
  const taxRows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.taxYears}`);
  if ((taxRows[0]?.n ?? 0) > 0) {
    const existingTax = await query<{ dedupe_key: string; due_date: string }>(
      `SELECT dedupe_key, due_date FROM ${T.reminders} WHERE source = 'derived' AND type = 'tax_deadline'`,
    );
    const taxDueByKey = new Map(existingTax.map((r) => [r.dedupe_key, r.due_date]));
    for (const d of INDIA_TAX_DEADLINES) {
      const key = `tax:${d.key}`;
      sources.push({
        dedupe_key: key,
        type: "tax_deadline",
        title: d.title,
        due_date: taxDueByKey.get(key) ?? nextAnnualOnOrAfter(today, d.monthDay),
        cadence: "annual",
      });
    }
  }

  for (const s of sources) {
    await upsertDerived(s.dedupe_key, {
      type: s.type,
      title: s.title,
      due_date: s.due_date,
      cadence: s.cadence ?? "once",
      notes: s.notes ?? null,
      account_id: s.account_id ?? null,
      document_id: s.document_id ?? null,
    });
  }

  // Drop derived rows whose source disappeared (date cleared / record deleted).
  const liveKeys = sources.map((s) => s.dedupe_key);
  if (liveKeys.length > 0) {
    const placeholders = liveKeys.map(() => "?").join(", ");
    await exec(
      `DELETE FROM ${T.reminders} WHERE source = 'derived' AND dedupe_key NOT IN (${placeholders})`,
      liveKeys,
    );
  } else {
    await exec(`DELETE FROM ${T.reminders} WHERE source = 'derived'`);
  }

  return sources.length;
}

export async function countOpenReminders(): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${T.reminders} WHERE status = 'open'`,
  );
  return rows[0]?.n ?? 0;
}
