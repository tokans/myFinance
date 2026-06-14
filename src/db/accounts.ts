import { query, exec, getDb, T } from "./client";
import type { AccountType } from "@/lib/accountTypes";

export type { AccountType };

/** Whether an account adds to (asset) or subtracts from (liability) net worth. */
export type AccountKind = "asset" | "liability";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  opening_balance: number;
  credential_id: number | null;
  is_archived: number;
  created_at: string;
  /** Free-text description, used when type === 'other'. */
  type_note: string | null;
  /** 'YYYY-MM-DD' maturity date; only meaningful for fixed deposits, else null. */
  maturity_date: string | null;
  /** Who to reach about this account in an emergency (name + phone/email). Optional. */
  contact: string | null;
  /** What a family member should do for this account in an emergency. Optional. */
  emergency_action: string | null;
  /** Operation mode: single / joint / either_or_survivor / former_or_survivor. Optional. */
  holding_mode: string | null;
  /** SIP debit day-of-month (1..31); only meaningful for mutual_funds, else null. */
  sip_day: number | null;
  /** Optional SIP installment amount; display only. */
  sip_amount: number | null;
  /** 'YYYY-MM-DD' of the SIP occurrence last marked Done/Ignore; null until acted. */
  sip_last_done: string | null;
}

export interface AccountInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  currency?: string;
  opening_balance?: number;
  type_note?: string | null;
  /** 'YYYY-MM-DD'; persisted only when type === 'fixed_deposit'. */
  maturity_date?: string | null;
  /** Emergency contact (name + phone/email). Optional. */
  contact?: string | null;
  /** Emergency action note. Optional. */
  emergency_action?: string | null;
  /** SIP debit day-of-month (1..31); persisted only when type === 'mutual_funds'. */
  sip_day?: number | null;
  /** Optional SIP installment amount; persisted only when type === 'mutual_funds'. */
  sip_amount?: number | null;
}

/** A maturity date is only kept for term products (FDs); cleared otherwise. */
function maturityFor(input: AccountInput): string | null {
  return input.type === "fixed_deposit" ? input.maturity_date?.trim() || null : null;
}

/** SIP day is only kept for mutual funds; cleared otherwise. Validated to 1..31, else null. */
function sipDayFor(input: AccountInput): number | null {
  if (input.type !== "mutual_funds") return null;
  const d = input.sip_day;
  return d != null && Number.isFinite(d) && d >= 1 && d <= 31 ? Math.trunc(d) : null;
}

/** SIP amount is only kept for mutual funds with a SIP day set; cleared otherwise. */
function sipAmountFor(input: AccountInput): number | null {
  if (sipDayFor(input) == null) return null;
  const a = input.sip_amount;
  return a != null && Number.isFinite(a) && a > 0 ? a : null;
}

export async function listAccounts(opts: { includeArchived?: boolean } = {}): Promise<Account[]> {
  const where = opts.includeArchived ? "" : "WHERE is_archived = 0";
  return query<Account>(`SELECT * FROM ${T.accounts} ${where} ORDER BY name COLLATE NOCASE`);
}

export async function getAccount(id: number): Promise<Account | null> {
  const rows = await query<Account>(`SELECT * FROM ${T.accounts} WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export async function createAccount(input: AccountInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO ${T.accounts} (name, type, institution, currency, opening_balance, type_note, maturity_date, contact, emergency_action, sip_day, sip_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.type,
      input.institution?.trim() || null,
      input.currency ?? "INR",
      input.opening_balance ?? 0,
      input.type === "other" ? input.type_note?.trim() || null : null,
      maturityFor(input),
      input.contact?.trim() || null,
      input.emergency_action?.trim() || null,
      sipDayFor(input),
      sipAmountFor(input),
    ],
  );
  return Number(result.lastInsertId);
}

export async function updateAccount(id: number, input: AccountInput): Promise<void> {
  const sipDay = sipDayFor(input);
  await exec(
    `UPDATE ${T.accounts}
       SET name = ?, type = ?, institution = ?, currency = ?, opening_balance = ?, type_note = ?, maturity_date = ?,
           contact = ?, emergency_action = ?, sip_day = ?, sip_amount = ?,
           -- Keep the cycle marker while a SIP is configured; clear it when the SIP is removed.
           sip_last_done = CASE WHEN ? IS NULL THEN NULL ELSE sip_last_done END
     WHERE id = ?`,
    [
      input.name.trim(),
      input.type,
      input.institution?.trim() || null,
      input.currency ?? "INR",
      input.opening_balance ?? 0,
      input.type === "other" ? input.type_note?.trim() || null : null,
      maturityFor(input),
      input.contact?.trim() || null,
      input.emergency_action?.trim() || null,
      sipDay,
      sipAmountFor(input),
      sipDay,
      id,
    ],
  );
}

/**
 * Fill in a fixed deposit's maturity date if it doesn't already have one. Used
 * by the importer to prefill FD maturity dates from a "maturity" column without
 * clobbering a value the user has already set. No-op for non-FD accounts.
 */
export async function setAccountMaturityDateIfEmpty(id: number, maturityDate: string): Promise<void> {
  await exec(
    `UPDATE ${T.accounts} SET maturity_date = ?
      WHERE id = ? AND type = 'fixed_deposit' AND (maturity_date IS NULL OR maturity_date = '')`,
    [maturityDate, id],
  );
}

/**
 * Fill in an account's emergency contact and/or action from an import without
 * clobbering anything the user has already set. Each field is written only when
 * it's currently empty and a non-blank value was supplied. No-op when both are
 * empty. Used by the Excel importer to carry "what to do" / "contact" columns
 * onto matched or freshly created accounts.
 */
export async function setAccountEmergencyIfEmpty(
  id: number,
  fields: { contact?: string | null; emergency_action?: string | null },
): Promise<void> {
  const contact = fields.contact?.trim();
  const action = fields.emergency_action?.trim();
  if (contact) {
    await exec(
      `UPDATE ${T.accounts} SET contact = ? WHERE id = ? AND (contact IS NULL OR contact = '')`,
      [contact, id],
    );
  }
  if (action) {
    await exec(
      `UPDATE ${T.accounts} SET emergency_action = ? WHERE id = ? AND (emergency_action IS NULL OR emergency_action = '')`,
      [action, id],
    );
  }
}

/**
 * Mark a SIP occurrence handled (the user swiped Done or Ignore on the reminder).
 * Records the occurrence date as the account's `sip_last_done` cycle marker and
 * drops the derived `sip:{id}` reminder so the inbox updates immediately; the
 * next month, within the lead window, `syncDerivedReminders` recreates it for the
 * following occurrence. See `domain/sip.ts` `sipReminderPlan`.
 */
export async function advanceSip(accountId: number, occurrenceDate: string): Promise<void> {
  await exec(`UPDATE ${T.accounts} SET sip_last_done = ? WHERE id = ?`, [occurrenceDate, accountId]);
  await exec(`DELETE FROM ${T.reminders} WHERE source = 'derived' AND dedupe_key = ?`, [`sip:${accountId}`]);
}

export async function archiveAccount(id: number, archived: boolean): Promise<void> {
  await exec(`UPDATE ${T.accounts} SET is_archived = ? WHERE id = ?`, [archived ? 1 : 0, id]);
}

/** Set just an account's type. Clears any "Others" note since the type is now concrete. */
export async function setAccountType(id: number, type: AccountType): Promise<void> {
  await exec(`UPDATE ${T.accounts} SET type = ?, type_note = NULL WHERE id = ?`, [type, id]);
}

/** Set just an account's institution (used by the bulk auto-detect on the Accounts page). */
export async function setAccountInstitution(id: number, institution: string): Promise<void> {
  await exec(`UPDATE ${T.accounts} SET institution = ? WHERE id = ?`, [institution.trim() || null, id]);
}

/**
 * Permanently delete an account and its dependent data: monthly snapshots cascade
 * away, linked reminders are removed, and the credential's `vault_entries` row is
 * dropped so it isn't orphaned (the Stronghold secret itself is best-effort
 * removed by the caller while the vault is unlocked — see AccountDetail). Documents
 * are deliberately *not* deleted: their `account_id` FK is ON DELETE SET NULL, so
 * they survive (managed on the Documents page) with the link cleared.
 *
 * Reminders/vault rows are deleted explicitly rather than via FK cascade so the
 * cleanup doesn't depend on the runtime foreign_keys pragma (mirrors maintenance.ts
 * and buildMergeSql).
 */
export async function deleteAccount(id: number): Promise<void> {
  await exec(`DELETE FROM ${T.reminders} WHERE account_id = ?`, [id]);
  await exec(
    `DELETE FROM ${T.vaultEntries} WHERE id IN (SELECT credential_id FROM ${T.accounts} WHERE id = ? AND credential_id IS NOT NULL)`,
    [id],
  );
  await exec(`DELETE FROM ${T.accounts} WHERE id = ?`, [id]);
}

/**
 * Build the single transactional SQL script that merges `mergeIds` into
 * `survivorId`, or null when there is nothing to merge.
 *
 * It is returned as ONE multi-statement string (wrapped in BEGIN/COMMIT) on
 * purpose: the Tauri SQL plugin runs each `execute` call as `pool.execute(...)`,
 * which borrows a single connection from the pool for the whole string. Issuing
 * BEGIN and COMMIT as *separate* `execute` calls is unreliable — they can land
 * on different pooled connections, so the COMMIT throws "no transaction is
 * active" while the in-between statements have already autocommitted (the bug
 * that made merge "work" yet surface a DB error). Running everything in one
 * call keeps BEGIN…COMMIT on one connection, so the merge is truly atomic.
 *
 * IDs are inlined rather than bound because sqlx only runs every statement of a
 * multi-statement string when there are NO bind parameters (with params it
 * prepares just the first statement). Every id is asserted to be a safe integer
 * first, so inlining carries no injection risk.
 *
 * One UPDATE is emitted per doomed account (not a single `IN (...)` update) so
 * that when two doomed accounts share a month the survivor lacks, the first
 * claims it and the rest skip it — preserving "survivor's value wins, never a
 * UNIQUE(account_id, month) clash". Statements run in order within the
 * transaction, so each UPDATE sees the previous one's moves.
 *
 * Net worth signs every snapshot by its account's *type* at read time
 * (`aggregates.totalsByMonth`), so once a doomed account's values are reparented
 * onto the survivor they are read with the survivor's sign. When `kinds` is
 * supplied and a doomed account's kind differs from the survivor's (i.e. an
 * asset and a liability are being merged), its moved values are negated
 * (`-ABS(value)`) so they keep contributing with their original sign — e.g. a
 * loan folded into a bank account becomes negative and still subtracts. Omitting
 * `kinds` (or merging same-kind accounts) leaves values untouched.
 */
export function buildMergeSql(
  survivorId: number,
  mergeIds: number[],
  kinds?: Map<number, AccountKind>,
): string | null {
  const others = mergeIds.filter((id) => id !== survivorId);
  if (others.length === 0) return null;
  for (const id of [survivorId, ...others]) {
    if (!Number.isInteger(id)) throw new Error(`Invalid account id: ${id}`);
  }
  const survivorKind = kinds?.get(survivorId);
  const list = others.join(", ");
  const moves = others
    .map((id) => {
      const doomedKind = kinds?.get(id);
      const flip =
        survivorKind != null && doomedKind != null && doomedKind !== survivorKind;
      const setValue = flip ? ", value = -ABS(value)" : "";
      return (
        `UPDATE ${T.monthlySnapshot} SET account_id = ${survivorId}${setValue} ` +
        `WHERE account_id = ${id} ` +
        `AND month NOT IN (SELECT month FROM ${T.monthlySnapshot} WHERE account_id = ${survivorId});`
      );
    })
    .join("\n");
  return [
    "BEGIN;",
    moves,
    // Drop the merged-away accounts' credential pointers so vault_entries aren't orphaned.
    `DELETE FROM ${T.vaultEntries} WHERE id IN (SELECT credential_id FROM ${T.accounts} WHERE id IN (${list}) AND credential_id IS NOT NULL);`,
    // Drop reminders linked to the merged-away accounts (derived ones like fd:/sip:
    // would point at data that didn't move to the survivor; manual ones lose their
    // account). The FK cascades too, but we delete explicitly so it never depends
    // on the runtime foreign_keys pragma.
    `DELETE FROM ${T.reminders} WHERE account_id IN (${list});`,
    // Delete the merged-away accounts; any remaining (overlapping) snapshots cascade.
    `DELETE FROM ${T.accounts} WHERE id IN (${list});`,
    "COMMIT;",
  ].join("\n");
}

/**
 * Merge several accounts into one survivor. The survivor keeps its own name,
 * type, institution, currency, opening balance and credential. Each other
 * account's monthly snapshots are moved onto the survivor *except* for months
 * the survivor already has a value for — there the survivor's value wins. The
 * merged-away accounts (and their dangling credential pointers) are deleted.
 *
 * Pass `kinds` (id → asset/liability) so that merging an asset with a liability
 * negates the cross-kind values, keeping net worth correct under the survivor's
 * type. See {@link buildMergeSql}.
 */
export async function mergeAccounts(
  survivorId: number,
  mergeIds: number[],
  kinds?: Map<number, AccountKind>,
): Promise<void> {
  const sql = buildMergeSql(survivorId, mergeIds, kinds);
  if (!sql) return;
  const db = await getDb();
  await db.execute(sql);
}

/** Total number of accounts (including archived). */
export async function countAccounts(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.accounts}`);
  return rows[0]?.n ?? 0;
}

/**
 * Number of accounts that have a non-empty emergency action filled in. Used to
 * gate the Emergency Planning feature — it unlocks once at least one account
 * records what a family member should do in an emergency.
 */
export async function countAccountsWithEmergencyAction(): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${T.accounts} WHERE emergency_action IS NOT NULL AND TRIM(emergency_action) <> ''`,
  );
  return rows[0]?.n ?? 0;
}

/** Delete every account. Their monthly snapshots cascade away; goals are left intact. */
export async function clearAllAccounts(): Promise<void> {
  await exec(`DELETE FROM ${T.accounts}`);
}

export interface VaultEntryRef {
  id: number;
  label: string;
  stronghold_key: string;
}

export async function getCredentialRef(accountId: number): Promise<VaultEntryRef | null> {
  const rows = await query<VaultEntryRef>(
    `SELECT v.id AS id, v.label AS label, v.stronghold_key AS stronghold_key
       FROM ${T.accounts} a
       JOIN ${T.vaultEntries} v ON v.id = a.credential_id
      WHERE a.id = ?`,
    [accountId],
  );
  return rows[0] ?? null;
}

export async function attachCredential(accountId: number, label: string, strongholdKey: string): Promise<void> {
  // Use the INSERT's own lastInsertId rather than a separate
  // `SELECT last_insert_rowid()` — the latter is unreliable (it can land on a
  // different pooled connection, and migration 0021's AFTER INSERT trigger runs
  // an extra UPDATE on the row), which set credential_id to a bad id and tripped
  // the foreign key. This mirrors createAccount() and the other inserts.
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO ${T.vaultEntries} (label, stronghold_key) VALUES (?, ?)`,
    [label, strongholdKey],
  );
  const vaultId = Number(result.lastInsertId);
  await exec(`UPDATE ${T.accounts} SET credential_id = ? WHERE id = ?`, [vaultId, accountId]);
}

export async function detachCredential(accountId: number): Promise<void> {
  const ref = await getCredentialRef(accountId);
  if (!ref) return;
  await exec(`UPDATE ${T.accounts} SET credential_id = NULL WHERE id = ?`, [accountId]);
  await exec(`DELETE FROM ${T.vaultEntries} WHERE id = ?`, [ref.id]);
}
