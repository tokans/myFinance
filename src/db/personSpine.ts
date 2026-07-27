/**
 * One-time PERSON-SPINE migration (suite hygiene finding 2.1, invariant 6).
 *
 * Before: myFinance kept its OWN person-identity table `myfinance_people`
 * (name/relationship/phone/email/id_proof_ref/access_tier/notes) IN PARALLEL to the
 * shared `common_person` spine — two sources of truth for identity.
 *
 * After: identity is single-sourced on `common_person` (display_name / relationship_to_self
 * / contact_phone / contact_email); the finance estate fields it OWNS (access_tier /
 * id_proof_ref / notes) live on `myfinance_person_facet`; and `myfinance_people` collapses to
 * a THIN spine link — just its historical integer `id` (the relational key every estate FK
 * joins on) plus a `person_key` mapping to the spine. Every FK
 * (holdings.person_id, will_meta.executor/guardian, incapacity_meta.poa_attorney,
 * insurance.claims_contact_person_id, documents.person_id, reminders.person_id,
 * access_grants.person_id) keeps referencing `myfinance_people(id)` with its exact
 * ON DELETE CASCADE/SET NULL behaviour — the integer ids are PRESERVED, so no FK remap is
 * needed and every estate reference survives intact.
 *
 * Mirrors myHealth's profiles spine-collapse (its `myhealth_profiles` thin link) and reuses
 * the established consolidate.ts migration discipline:
 *   - **Idempotent** — a `person-spine` ledger row (in the same `myfinance#MigrationLedger`)
 *     marks completion; a populated DB whose `myfinance_people` still has the legacy identity
 *     columns is migrated once; later boots no-op.
 *   - **Resumable / crash-safe** — runs inside a single transaction; until it commits, the
 *     old-shape table + its data are intact, so a crash mid-migration simply re-runs next boot.
 *   - **Key-preserving** — the integer `id` of every people row is untouched; only identity
 *     columns are dropped after their values are copied to the spine + facet.
 *   - **Verified** — copied-row count and a content checksum (spine identity ⊕ facet domain)
 *     are computed over the pre-migration rows and re-verified post-copy before the columns
 *     are dropped; any mismatch THROWS and the transaction rolls back (no data loss).
 *
 * `person_key` for a finance contact is `mf-<id>` (stable, unique per local id) — NOT a name
 * slug, so two distinct people who share a name never collapse into one identity. Cross-app
 * de-dup against myHealth/self stays a human-confirmed SUGGESTION (suggestPersonDuplicates),
 * never an auto-merge (suite invariant: explicit-reference identity).
 *
 * The pure engine ({@link migratePersonSpine}) is dependency-injected and unit-tested against
 * real-SQLite fixtures; {@link runPersonSpineMigration} is the thin Tauri wiring.
 */
import type { SqlDb } from "sharedcorelib/db";
import { checksumRows } from "./consolidate";
import { T } from "./tables";

/** Stable, collision-free person_key for a finance contact (never a name slug). */
export const personKeyForLocal = (id: number): string => `mf-${id}`;

const ident = (s: string): string => `"${s.replace(/[^A-Za-z0-9_]/g, "_")}"`;

/** The legacy identity columns dropped from myfinance_people once copied to the spine/facet. */
const LEGACY_IDENTITY_COLUMNS = [
  "name", "relationship", "phone", "email", "id_proof_ref", "access_tier", "notes",
] as const;

const LEDGER_ENTRY = "person-spine";

interface LegacyPeopleRow {
  id: number;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  id_proof_ref: string | null;
  access_tier: number | null;
  notes: string | null;
  created_at: string | null;
  sync_id: string | null;
  updated_at: string | null;
}

export interface PersonSpineDeps {
  /** The shared suite DB (schemas + aux + legacy consolidation already run by the caller). */
  suite: SqlDb;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface PersonSpineResult {
  status: "migrated" | "already-done" | "already-thin" | "no-table";
  /** People rows lifted onto the spine. */
  rows: number;
  /** Content checksum of the lifted identity ⊕ facet rows. */
  checksum: string;
}

async function tableExists(db: SqlDb, table: string): Promise<boolean> {
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?`, [table],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function columnNames(db: SqlDb, table: string): Promise<Set<string>> {
  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${ident(table)})`);
  return new Set(rows.map((r) => String(r.name)));
}

async function readLedger(db: SqlDb, entryId: string): Promise<{ status: string } | null> {
  const rows = await db.select<{ status: string }>(
    `SELECT status FROM ${ident(T.migrationLedger)} WHERE entry_id = ?`, [entryId],
  );
  return rows[0] ?? null;
}

async function writeLedger(
  db: SqlDb, status: string, rows: number, checksum: string | null, detail: string, now: () => Date,
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO ${ident(T.migrationLedger)} ` +
      `(entry_id, table_name, legacy_rows, copied_rows, checksum, status, detail, completed_at) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [LEDGER_ENTRY, "people", rows, rows, checksum, status, detail, now().toISOString()],
  );
}

/**
 * The checksum sample for a person row: the identity it will carry on the spine ⊕ the finance
 * facet fields, in a fixed shape so a re-read after the copy can prove byte-equivalence.
 */
function spineSample(row: LegacyPeopleRow): Record<string, unknown> {
  return {
    id: row.id,
    person_key: personKeyForLocal(row.id),
    display_name: row.name,
    relationship_to_self: row.relationship ?? null,
    contact_phone: row.phone ?? null,
    contact_email: row.email ?? null,
    access_tier: row.access_tier ?? 0,
    id_proof_ref: row.id_proof_ref ?? null,
    notes: row.notes ?? null,
  };
}

/**
 * Migrate the legacy `myfinance_people` identity table onto the shared person spine. Pure DI
 * (see module doc). Call AFTER `ensureSuiteSchema` + the legacy consolidation, so the suite
 * `myfinance_people` table (and any migrated rows) exist.
 */
export async function migratePersonSpine(deps: PersonSpineDeps): Promise<PersonSpineResult> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const { suite } = deps;

  if (!(await tableExists(suite, T.people))) {
    log("no myfinance_people table — nothing to lift");
    return { status: "no-table", rows: 0, checksum: "" };
  }

  // Idempotent: a completed ledger row means we're done.
  const done = await readLedger(suite, LEDGER_ENTRY);
  if (done?.status === "done") {
    log("person-spine migration already done");
    return { status: "already-done", rows: 0, checksum: "" };
  }

  // If the table is already thin (has person_key, lacks the legacy identity columns), there is
  // nothing to lift — record the marker so later boots short-circuit cleanly.
  const cols = await columnNames(suite, T.people);
  const isThin = cols.has("person_key") && !cols.has("name");
  if (isThin) {
    await writeLedger(suite, "done", 0, null, "already thin (fresh install)", now);
    log("myfinance_people already thin — no identity to lift");
    return { status: "already-thin", rows: 0, checksum: "" };
  }

  // Read every legacy people row in id order (stable for the checksum).
  const people = await suite.select<LegacyPeopleRow>(
    `SELECT * FROM ${ident(T.people)} ORDER BY id`,
  );
  const samples = people.map(spineSample);
  const checksum = checksumRows(samples);

  // Everything below is one transaction: the old-shape table + data stay intact until COMMIT,
  // so a crash anywhere simply re-runs the whole migration on the next boot.
  await suite.execute("BEGIN");
  try {
    for (const p of people) {
      const key = personKeyForLocal(p.id);
      const ts = p.updated_at ?? p.created_at ?? now().toISOString();

      // 1. Identity → common_person (single source of truth). Explicit-reference upsert by key;
      //    finance is the writer of record for these contacts (they originate here).
      await suite.execute(
        `INSERT INTO "common_person"
           (person_key, display_name, relationship_to_self, contact_phone, contact_email, updated_at, source_app)
         VALUES (?, ?, ?, ?, ?, ?, 'myfinance')
         ON CONFLICT(person_key) DO UPDATE SET
           display_name         = COALESCE(excluded.display_name, display_name),
           relationship_to_self = COALESCE(excluded.relationship_to_self, relationship_to_self),
           contact_phone        = COALESCE(excluded.contact_phone, contact_phone),
           contact_email        = COALESCE(excluded.contact_email, contact_email),
           updated_at           = excluded.updated_at,
           source_app           = 'myfinance'`,
        [key, p.name, p.relationship ?? null, p.phone ?? null, p.email ?? null, ts],
      );

      // 2. Finance estate fields → myfinance_person_facet, keyed by person_key. access_tier
      //    lives here (estate-domain progressive-disclosure, NOT cross-app identity).
      await suite.execute(
        `INSERT INTO ${ident(T.personFacet)}
           (person_key, access_tier, id_proof_ref, notes, local_person_id, updated_at, source_app)
         VALUES (?, ?, ?, ?, ?, ?, 'myfinance')
         ON CONFLICT(person_key) DO UPDATE SET
           access_tier     = excluded.access_tier,
           id_proof_ref    = excluded.id_proof_ref,
           notes           = excluded.notes,
           local_person_id = excluded.local_person_id,
           updated_at      = excluded.updated_at,
           source_app      = 'myfinance'`,
        [key, p.access_tier ?? 0, p.id_proof_ref ?? null, p.notes ?? null, p.id, ts],
      );

      // 3. Stamp the link row's person_key (added below) — done after the column exists.
    }

    // Add the person_key link column (nullable first), backfill it, then enforce uniqueness.
    if (!cols.has("person_key")) {
      await suite.execute(`ALTER TABLE ${ident(T.people)} ADD COLUMN person_key TEXT`);
    }
    for (const p of people) {
      await suite.execute(
        `UPDATE ${ident(T.people)} SET person_key = ? WHERE id = ?`, [personKeyForLocal(p.id), p.id],
      );
    }
    await suite.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_mf_people_person_key ON ${ident(T.people)}(person_key)`,
    );

    // VERIFY before retiring identity columns: re-read identity ⊕ facet from the spine and prove
    // byte-equivalence to the pre-migration sample. Any mismatch THROWS → rollback (no loss).
    const verifyRows: Record<string, unknown>[] = [];
    for (const p of people) {
      const key = personKeyForLocal(p.id);
      const [person] = await suite.select<Record<string, unknown>>(
        `SELECT display_name, relationship_to_self, contact_phone, contact_email FROM "common_person" WHERE person_key = ?`,
        [key],
      );
      const [facet] = await suite.select<Record<string, unknown>>(
        `SELECT access_tier, id_proof_ref, notes FROM ${ident(T.personFacet)} WHERE person_key = ?`,
        [key],
      );
      verifyRows.push({
        id: p.id,
        person_key: key,
        display_name: person?.display_name ?? null,
        relationship_to_self: person?.relationship_to_self ?? null,
        contact_phone: person?.contact_phone ?? null,
        contact_email: person?.contact_email ?? null,
        access_tier: facet?.access_tier ?? 0,
        id_proof_ref: facet?.id_proof_ref ?? null,
        notes: facet?.notes ?? null,
      });
    }
    const verifyChecksum = checksumRows(
      verifyRows.map((r) => ({
        id: r.id, person_key: r.person_key, display_name: r.display_name,
        relationship_to_self: r.relationship_to_self, contact_phone: r.contact_phone,
        contact_email: r.contact_email, access_tier: r.access_tier,
        id_proof_ref: r.id_proof_ref, notes: r.notes,
      })),
    );
    if (verifyChecksum !== checksum) {
      throw new Error(`person-spine verify failed: ${verifyChecksum} != ${checksum}`);
    }

    // Retire the legacy identity columns — myfinance_people is now a thin link. The integer id
    // (and every child FK that joins on it) is untouched. SQLite ALTER … DROP COLUMN leaves the
    // sync_id unique index + the 0021 triggers intact (they reference id/sync_id, not these).
    const presentCols = await columnNames(suite, T.people);
    for (const c of LEGACY_IDENTITY_COLUMNS) {
      if (presentCols.has(c)) await suite.execute(`ALTER TABLE ${ident(T.people)} DROP COLUMN ${ident(c)}`);
    }

    await writeLedger(
      suite, "done", people.length, checksum,
      `lifted ${people.length} people onto common_person + ${T.personFacet}`, now,
    );
    await suite.execute("COMMIT");
  } catch (e) {
    try { await suite.execute("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }

  log(`person-spine migration done — ${people.length} people lifted, ${checksum}`);
  return { status: "migrated", rows: people.length, checksum };
}

/**
 * Run the person-spine migration inside Tauri (after the legacy consolidation). Errors are
 * logged, not thrown — a failed run rolls back (the old-shape table is intact) and retries on
 * the next launch.
 */
export async function runPersonSpineMigration(suite: SqlDb): Promise<PersonSpineResult | null> {
  try {
    return await migratePersonSpine({ suite, log: (m) => console.info(`[person-spine] ${m}`) });
  } catch (e) {
    console.error("[person-spine] migration failed — will retry next launch:", e);
    return null;
  }
}
