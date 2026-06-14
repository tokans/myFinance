/**
 * Shared-entity spine wiring (sharedcorelib/entities) for myFinance — Stage C migration.
 *
 * myFinance is the suite's deepest core consumer. Estate people/nominees/contacts now
 * REFERENCE the shared `common_person` identity (explicit-reference, no auto-merge), and
 * financial/physical holdings project onto the shared `common_asset` table so myFinance can
 * act as the cross-app **net-worth aggregator** (assets contributed by myHome/myHobbies are
 * summed alongside its own). Documents → `common_document`, cross-app life-events →
 * `common_event`.
 *
 * Design rules honored (contracts/entities.md, suite invariant 6):
 *   - The shared `person` row is identity ONLY. Finance-specific data (estate access tier,
 *     id-proof, notes) lives in the myFinance-owned facet table keyed by `person_key`
 *     (field-level ownership). We never re-model the person locally.
 *   - Identity is explicit-reference: {@link pickOrCreatePerson}. Dedup is a *suggestion*
 *     a human confirms ({@link suggestPersonDuplicates}) — never an auto-merge.
 *
 * This module is ADDITIVE and Tauri-only. The app's own `myfinance.db` `people`/`accounts`
 * tables are untouched by this; this layer mirrors/links them into the shared `suite.db`.
 */
import { isTauri } from "@/lib/environment";
import { openSharedDbAdapter } from "./sharedDb";
import {
  createEntitiesStore,
  personKeyFor,
  type EntitiesStore,
  type Person as SharedPerson,
  type Asset as SharedAsset,
  type DocumentRow as SharedDocument,
  type EventRow as SharedEvent,
  type DuplicateSuggestion,
} from "sharedcorelib/entities";
import { tableName, createTableSql, type SqlDb } from "sharedcorelib/db";
import { MYFINANCE_PERSON_FACET_SCHEMA } from "./schemas";

const APP_ID = "myfinance";

export type {
  SharedPerson, SharedAsset, SharedDocument, SharedEvent, DuplicateSuggestion,
};
export { personKeyFor };

/** Finance-specific facet of a shared person (kept beside core identity, not inside it). */
export interface PersonFacet {
  person_key: string;
  access_tier?: number | null;
  id_proof_ref?: string | null;
  notes?: string | null;
  local_person_id?: number | null;
  updated_at?: string | null;
  source_app?: string | null;
}

const FACET_TABLE = `"${tableName(MYFINANCE_PERSON_FACET_SCHEMA).replace(/[^A-Za-z0-9_]/g, "_")}"`;

/**
 * The shared entities store bound to the suite DB, or null outside Tauri / when the shared
 * DB can't be opened (callers degrade gracefully, exactly like {@link iceStore}).
 */
export async function entitiesStore(): Promise<EntitiesStore | null> {
  if (!isTauri()) return null;
  try {
    const sql = await openSharedDbAdapter();
    const store = createEntitiesStore(sql, { appId: APP_ID });
    await store.ensure();
    return store;
  } catch (e) {
    console.warn("shared entities store unavailable:", e);
    return null;
  }
}

// ── Person facet store (DI: pass the SqlDb so it's unit-testable) ────────────

export function createPersonFacetStore(db: SqlDb) {
  return {
    ensure: async () => {
      for (const sql of createTableSql(MYFINANCE_PERSON_FACET_SCHEMA)) await db.execute(sql);
    },
    get: async (personKey: string): Promise<PersonFacet | null> =>
      (await db.select<PersonFacet>(`SELECT * FROM ${FACET_TABLE} WHERE person_key = ?`, [personKey]))[0] ?? null,
    list: (): Promise<PersonFacet[]> => db.select<PersonFacet>(`SELECT * FROM ${FACET_TABLE}`),
    upsert: async (f: PersonFacet): Promise<void> => {
      const cols = ["person_key", "access_tier", "id_proof_ref", "notes", "local_person_id", "updated_at", "source_app"] as const;
      const row = { ...f, source_app: f.source_app ?? APP_ID, updated_at: f.updated_at ?? new Date().toISOString() };
      await db.execute(
        `INSERT OR REPLACE INTO ${FACET_TABLE} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        cols.map((c) => (row as Record<string, unknown>)[c] ?? null),
      );
    },
    remove: async (personKey: string): Promise<void> => {
      await db.execute(`DELETE FROM ${FACET_TABLE} WHERE person_key = ?`, [personKey]);
    },
  };
}

export type PersonFacetStore = ReturnType<typeof createPersonFacetStore>;

// ── Pure helpers (DI; unit-testable without Tauri) ──────────────────────────

/** A myFinance local `people` row (subset needed to project into the shared spine). */
export interface LocalPersonLike {
  id: number;
  name: string;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
  access_tier?: number | null;
  id_proof_ref?: string | null;
  notes?: string | null;
  isSelf?: boolean;
}

/**
 * Project a local estate person onto the shared spine by EXPLICIT REFERENCE: pick the
 * existing shared `person` for its key (or create a thin identity), then store finance
 * facet data beside it. Returns the resolved `person_key`. Never merges identities.
 */
export async function linkLocalPerson(
  entities: EntitiesStore,
  facets: PersonFacetStore,
  local: LocalPersonLike,
): Promise<string> {
  const key = personKeyFor({ isSelf: !!local.isSelf, name: local.name });
  // Explicit-reference: resolve (or thinly create) the shared identity for this key —
  // NEVER merging two identities. Then write the latest identity fields for THIS key
  // (editing the same referenced person is legitimate; it is not a merge).
  await entities.pickOrCreatePerson(key, { display_name: local.name });
  await entities.upsertPerson({
    person_key: key,
    display_name: local.name,
    relationship_to_self: local.relationship ?? null,
    contact_phone: local.phone ?? null,
    contact_email: local.email ?? null,
  });
  await facets.upsert({
    person_key: key,
    access_tier: local.access_tier ?? 0,
    id_proof_ref: local.id_proof_ref ?? null,
    notes: local.notes ?? null,
    local_person_id: local.id,
  });
  return key;
}

/**
 * Guided-merge: which shared people *look* like duplicates of a local person (same name
 * and/or DOB)? SUGGEST ONLY — the caller surfaces these to a human who confirms. Used to
 * dedupe against health profiles / memories persons across the suite.
 */
export async function suggestPersonDuplicates(
  entities: EntitiesStore,
  local: { name: string; dob?: string | null; person_key?: string },
): Promise<DuplicateSuggestion[]> {
  return entities.suggestDuplicates({
    display_name: local.name,
    dob: local.dob ?? null,
    person_key: local.person_key,
  });
}

// ── Net-worth aggregation (Phase 2) ─────────────────────────────────────────

/** A locally-owned finance asset (one per account) projected into the shared spine. */
export interface LocalAssetLike {
  /** stable id for the shared asset row (e.g. `myfinance:account:<id>`) */
  id: string;
  label: string;
  value?: number | null;
  ownerKey?: string | null;
  type?: SharedAsset["type"];
}

/** Project a local finance account onto the shared `asset` spine (type=account). */
export async function publishLocalAsset(entities: EntitiesStore, a: LocalAssetLike): Promise<void> {
  await entities.upsertAsset({
    id: a.id,
    type: a.type ?? "account",
    label: a.label,
    value: a.value ?? null,
    owner: a.ownerKey ?? "self",
  });
}

export interface NetWorthAggregate {
  /** every asset across the suite owned by `ownerKey` (finance + myHome + myHobbies, …) */
  assets: SharedAsset[];
  /** summed value of those assets (the cross-app net worth) */
  total: number;
  /** breakdown by the contributing `source_app` (provenance of cross-app contributions) */
  byApp: Record<string, number>;
}

/**
 * Aggregate net worth across ALL shared assets owned by a person — including assets
 * contributed by sibling apps (myHome property, myHobbies collections). myFinance becomes
 * the suite aggregator; the estate register reads from this shared view, not a private copy.
 */
export async function aggregateNetWorth(
  entities: EntitiesStore,
  ownerKey = "self",
): Promise<NetWorthAggregate> {
  const { assets, total } = await entities.assetsForOwner(ownerKey);
  const byApp: Record<string, number> = {};
  for (const a of assets) {
    const app = a.source_app ?? "unknown";
    byApp[app] = (byApp[app] ?? 0) + (typeof a.value === "number" ? a.value : 0);
  }
  return { assets, total, byApp };
}
